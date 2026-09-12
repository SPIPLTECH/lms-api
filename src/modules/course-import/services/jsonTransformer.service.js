const registry = require("./extractors/registry");
const { classifyBlocks } = require("./contentClassifier.service");
const { splitOnUrls, getVideoProvider } = require("./urlDetector.service");
const { analyzeStructure } = require("./structureAnalyzer.service");
const scormExtractor = require("./extractors/scorm.extractor");

/**
 * Rewrites a block's markdown in place so an image URL it contains renders
 * as a real inline ![]() embed at its exact position — safe to run on any
 * block's full markdown, table cells included, since substituting one
 * inline-text form for another never introduces the pipe/newline
 * characters that would corrupt a markdown table's row structure.
 */
const inlineImageUrls = (markdown) => {
  const segments = splitOnUrls(markdown);
  if (!segments.some((s) => s.type === "url" && s.contentType === "image")) return markdown;

  return segments
    .map((s) => {
      if (s.type === "text") return s.text;
      if (s.contentType === "image") return `![${s.linkText || ""}](${s.url})`;
      return s.linkText !== undefined ? `[${s.linkText}](${s.url})` : s.url;
    })
    .join("");
};

/**
 * Splits a block's markdown at any video/audio URL it contains, replacing
 * it in place with a real playable block. html.extractor.js already does
 * this at the point of extraction for docx/html sources (carefully, so a
 * table's own row/cell structure never gets spliced apart) — this covers
 * the sources that don't go through that extractor at all: a PDF page's
 * plain text and a PPTX's combined multi-slide markdown, neither of which
 * has table syntax to protect. Recognized by `sourceElement !== "section"`
 * (html.extractor tags its own grouped blocks "section").
 */
const splitOutMediaUrls = (blocks) => {
  const expanded = [];

  for (const block of blocks) {
    if (!block.markdown || block.attributes?.sourceElement === "section") {
      expanded.push(block);
      continue;
    }

    const segments = splitOnUrls(block.markdown);
    const hasEmbeddableMedia = segments.some((s) => s.type === "url" && (s.contentType === "video" || s.contentType === "audio"));
    if (!hasEmbeddableMedia) {
      expanded.push(block);
      continue;
    }

    for (const segment of segments) {
      if (segment.type === "text") {
        if (segment.text.trim()) expanded.push({ ...block, markdown: segment.text });
      } else if (segment.contentType === "video" || segment.contentType === "audio") {
        expanded.push({
          blockType: segment.contentType,
          source: "external",
          url: segment.url,
          caption: segment.linkText || "",
          attributes: { detectedFrom: "text", ...(segment.contentType === "video" ? { provider: getVideoProvider(segment.url) } : {}) },
        });
      } else {
        expanded.push({ ...block, markdown: segment.linkText !== undefined ? `[${segment.linkText}](${segment.url})` : segment.url });
      }
    }
  }

  return expanded;
};

const extractFileBlocks = async (file, jobId, baseUrl) => {
  const extractor = registry.getExtractorFor(file);

  if (!extractor) {
    return [{
      blockType: "unknown",
      status: "UNMAPPED",
      original: { element: file.extension || "file", attributes: { fileName: file.fileName, size: file.size }, content: null, sourcePath: file.relativePath, reason: "unsupported file type" },
    }];
  }

  try {
    const ctx = { jobId, baseUrl, sourceRelativePath: file.relativePath };
    const raw = await extractor(file, ctx);
    return classifyBlocks(raw);
  } catch (error) {
    return [{
      blockType: "unknown",
      status: "UNMAPPED",
      original: { element: file.extension, sourcePath: file.relativePath, reason: `extraction failed: ${error.message}` },
    }];
  }
};

const buildLesson = async (lessonDef, jobId, baseUrl) => {
  const content = [];
  for (const file of lessonDef.files) {
    content.push(...(await extractFileBlocks(file, jobId, baseUrl)));
  }

  const withInlineImages = content.map((block) =>
    block.markdown ? { ...block, markdown: inlineImageUrls(block.markdown) } : block
  );
  const withMediaBlocks = splitOutMediaUrls(withInlineImages);
  return { title: lessonDef.title, order: lessonDef.order, sourcePath: lessonDef.files[0]?.relativePath || null, content: withMediaBlocks };
};

/** Drops a local-asset block if the same original file already appears in an earlier lesson within the same module (e.g. a video embedded inline by an HTML lesson AND also picked up as its own folder-lesson) — keeps the first occurrence, avoids showing the same file twice without ever losing an unreferenced one. */
const dedupeDuplicateLocalAssets = (modules) => {
  for (const moduleEntry of modules) {
    const seenPaths = new Set();
    for (const lesson of moduleEntry.lessons) {
      lesson.content = lesson.content.filter((block) => {
        if (!block.originalPath) return true;
        if (seenPaths.has(block.originalPath)) return false;
        seenPaths.add(block.originalPath);
        return true;
      });
    }
  }
  return modules.filter((m) => {
    m.lessons = m.lessons.filter((l) => l.content.length > 0);
    return true;
  });
};

const buildFromScorm = async (manifestFile, files, jobId, baseUrl, sourceFileName) => {
  const scormStructure = await scormExtractor.buildStructureFromManifest(manifestFile, files, { jobId, baseUrl });

  const modules = scormStructure.modules.map((m, mi) => ({
    title: m.title,
    order: mi + 1,
    sourcePath: m.sourcePath,
    lessons: m.lessons.map((l, li) => ({ title: l.title, order: li + 1, sourcePath: l.sourcePath, content: classifyBlocks(l.content) })),
  }));

  return {
    course: {
      title: scormStructure.courseTitle || sourceFileName.replace(/\.[^.]+$/, ""),
      description: "",
      category: "",
      level: "",
      metadata: { sourceFileName, sourceType: "SCORM" },
      modules,
      unmappedAssignments: [],
    },
  };
};

const signalExtractor = require("./signalExtractor.service");
const relationshipDetector = require("./relationshipDetector.service");
const lessonGrouping = require("./lessonGrouping.service");
const topicDetection = require("./topicDetection.service");
const resourceMapping = require("./resourceMapping.service");
const canonicalCourseMapper = require("./canonicalCourseMapper.service");

/** Orchestrates fileScanner output -> extraction -> deterministic mapping pipeline -> canonical Course JSON. */
const buildCanonicalCourse = async ({ files, jobId, baseUrl, sourceFileName }) => {
  const manifestFile = scormExtractor.detectManifest(files);
  if (manifestFile) {
    return buildFromScorm(manifestFile, files, jobId, baseUrl, sourceFileName);
  }

  const extractedFiles = await Promise.all(
    files.map(async (file) => {
      const extractor = registry.getExtractorFor(file);
      if (!extractor) {
        return { fileName: file.fileName, relativePath: file.relativePath, blocks: [] };
      }
      try {
        const ctx = { jobId, baseUrl, sourceRelativePath: file.relativePath };
        const rawBlocks = await extractor(file, ctx);
        const classified = classifyBlocks(rawBlocks);
        return { fileName: file.fileName, relativePath: file.relativePath, blocks: classified };
      } catch (err) {
        console.error(`Error extracting file ${file.fileName}:`, err.message);
        return { fileName: file.fileName, relativePath: file.relativePath, blocks: [] };
      }
    })
  );

  const blocksByFile = {};
  extractedFiles.forEach((ef) => {
    blocksByFile[ef.fileName] = ef.blocks;
    if (ef.relativePath) blocksByFile[ef.relativePath] = ef.blocks;
  });

  const rels = relationshipDetector.detectRelationships(extractedFiles);
  const grouping = lessonGrouping.groupLessons(rels);
  const topicResult = topicDetection.detectTopicsForCourse({ lessonGroupingResult: grouping, blocksByFile });
  const resMapping = resourceMapping.mapResources({
    lessonGroupingResult: grouping,
    topicDetectionResult: topicResult,
    relationshipResult: rels,
    blocksByFile
  });

  const canonicalCourseObj = canonicalCourseMapper.buildCanonicalCourse({
    courseMetadata: { title: sourceFileName ? sourceFileName.replace(/\.[^.]+$/, "") : "Imported Course" },
    lessonGroupingResult: grouping,
    topicDetectionResult: topicResult,
    resourceMappingResult: resMapping,
    relationshipResult: rels,
    blocksByFile
  });

  return {
    course: canonicalCourseObj
  };
};

module.exports = { buildCanonicalCourse, inlineImageUrls, splitOutMediaUrls };
