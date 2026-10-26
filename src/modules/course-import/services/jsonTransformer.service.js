const registry = require("./extractors/registry");
const { classifyBlocks } = require("./contentClassifier.service");
const scormExtractor = require("./extractors/scorm.extractor");

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

module.exports = { buildCanonicalCourse, };
