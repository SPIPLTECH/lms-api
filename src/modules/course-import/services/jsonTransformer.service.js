const registry = require("./extractors/registry");
const { classifyBlocks } = require("./contentClassifier.service");
const { detectUrls } = require("./urlDetector.service");
const { analyzeStructure } = require("./structureAnalyzer.service");
const scormExtractor = require("./extractors/scorm.extractor");

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

/** Surfaces bare URLs found inside extracted text (not already a markdown link) as their own blocks — nothing referenced in the source is dropped just because it wasn't wrapped in a tag. */
const appendUrlBlocksFromText = (blocks) => {
  const extra = [];

  for (const block of blocks) {
    if (block.blockType !== "text" || !block.markdown) continue;

    for (const { url, contentType } of detectUrls(block.markdown)) {
      if (block.markdown.includes(`](${url})`)) continue;

      if (contentType === "video") extra.push({ blockType: "video", source: "external", url, attributes: { detectedFrom: "text" } });
      else if (contentType === "image") extra.push({ blockType: "image", source: "external", url, alt: "", caption: "", attributes: { detectedFrom: "text" } });
      else if (contentType === "document") extra.push({ blockType: "document", source: "external", url, title: url, attributes: { detectedFrom: "text" } });
      else extra.push({ blockType: "link", url, title: url, attributes: { detectedFrom: "text" } });
    }
  }

  return extra;
};

const buildLesson = async (lessonDef, jobId, baseUrl) => {
  const content = [];
  for (const file of lessonDef.files) {
    content.push(...(await extractFileBlocks(file, jobId, baseUrl)));
  }
  content.push(...appendUrlBlocksFromText(content));

  return { title: lessonDef.title, order: lessonDef.order, sourcePath: lessonDef.files[0]?.relativePath || null, content };
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

/** Orchestrates fileScanner output -> extraction -> classification -> structure -> the canonical Course JSON. */
const buildCanonicalCourse = async ({ files, jobId, baseUrl, sourceFileName }) => {
  const manifestFile = scormExtractor.detectManifest(files);
  if (manifestFile) {
    return buildFromScorm(manifestFile, files, jobId, baseUrl, sourceFileName);
  }

  const { modules: structured, structureSource } = await analyzeStructure(files);

  const modules = [];
  for (const moduleDef of structured) {
    const lessons = [];
    for (const lessonDef of moduleDef.lessons) {
      lessons.push(await buildLesson(lessonDef, jobId, baseUrl));
    }
    modules.push({ title: moduleDef.title, order: moduleDef.order, lessons });
  }

  dedupeDuplicateLocalAssets(modules);

  return {
    course: {
      title: sourceFileName.replace(/\.[^.]+$/, ""),
      description: "",
      category: "",
      level: "",
      metadata: { sourceFileName, structureSource },
      modules: modules.filter((m) => m.lessons.length > 0),
      unmappedAssignments: [],
    },
  };
};

module.exports = { buildCanonicalCourse };
