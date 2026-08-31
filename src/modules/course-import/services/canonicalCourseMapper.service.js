/**
 * Phase 11 — Step 7: Deterministic Canonical Course Mapping Layer
 * Pure utility/service with zero database dependencies, zero filesystem side-effects, zero LLM calls.
 */

const { classifyBlock } = require("./contentClassifier.service");

/**
 * Clean text strings by stripping markdown links/anchors and normalizing whitespace.
 */
function cleanText(text) {
  if (!text || typeof text !== "string") return "";
  return text.replace(/\[\]\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Derives course title and description from source signals or provided metadata.
 */
function deriveCourseMetadata(courseMetadata = {}, lessons = []) {
  let title = courseMetadata.title;
  let code = courseMetadata.code || null;
  let description = courseMetadata.description || null;

  if (!title && lessons.length > 0) {
    const firstLessonTitle = lessons[0].title || "";
    if (firstLessonTitle.includes("Day 1")) {
      const extra = firstLessonTitle.split("—")[1]?.trim();
      title = extra ? `Module 1: ${extra}` : firstLessonTitle;
    } else {
      title = firstLessonTitle;
    }
  }

  return {
    title: title || "Untitled Course",
    code,
    description,
    category: courseMetadata.category || null,
    level: courseMetadata.level || null,
    price: courseMetadata.price !== undefined ? courseMetadata.price : null,
    currency: courseMetadata.currency || null,
    instructor: courseMetadata.instructor || null
  };
}

/**
 * Maps raw block items into canonical topic content objects while preserving all original block metadata.
 */
function mapCanonicalContents(blocks = [], sourceFile = "") {
  return (blocks || []).map((block, idx) => {
    const classified = classifyBlock(block);
    return {
      id: `content:${sourceFile}:${block.blockOrder ?? idx}`,
      order: idx + 1,
      blockType: classified.blockType,
      kind: block.kind || "text",
      markdown: block.markdown || block.text || "",
      htmlContent: block.htmlContent || null,
      sourceElement: block.attributes?.sourceElement || block.sourceElement || null,
      sourceFile: sourceFile || block.sourceFile || null,
      blockIndex: block.blockOrder ?? idx,
      attributes: block.attributes || {},
      data: block.data || null,
      status: classified.status || "UNMAPPED"
    };
  });
}

/**
 * Builds canonical topic objects for a lesson.
 */
function buildCanonicalTopics(topics = []) {
  return (topics || []).map((topic, idx) => {
    const contentBlocks = topic.blocks || [];
    const contents = mapCanonicalContents(contentBlocks, topic.sourceFile);

    return {
      key: topic.key || `topic:${topic.sourceFile}:${topic.startBlockOrder}`,
      title: cleanText(topic.title),
      order: topic.order || idx + 1,
      numberedSection: topic.numberedSection || null,
      startBlockOrder: topic.startBlockOrder,
      endBlockOrder: topic.endBlockOrder,
      blockCount: topic.blockCount || contentBlocks.length,
      contents,
      explainability: {
        confidence: topic.confidence || "high",
        detectionReason: topic.detectionReason || { type: "heading_match" },
        sourceFile: topic.sourceFile
      }
    };
  });
}

/**
 * Assembles canonical resource objects for lessons or modules with complete explainability metadata.
 */
function buildCanonicalResources(resources = []) {
  return (resources || []).map((res) => {
    return {
      sourceFile: res.sourceFile,
      relativePath: res.relativePath || res.sourceFile,
      memberType: res.memberType || "file",
      scope: res.scope,
      role: res.role,
      ...(res.lessonKey ? { lessonKey: res.lessonKey } : {}),
      ...(res.moduleKey ? { moduleKey: res.moduleKey } : {}),
      ...(res.topicKey ? { topicKey: res.topicKey } : {}),
      ...(res.startBlockOrder !== undefined ? { startBlockOrder: res.startBlockOrder } : {}),
      ...(res.endBlockOrder !== undefined ? { endBlockOrder: res.endBlockOrder } : {}),
      ...(res.matchedHeading ? { matchedHeading: res.matchedHeading } : {}),
      confidence: res.confidence || "high",
      explainability: res.reason || { type: "resource_classification" }
    };
  });
}

/**
 * Main Canonical Course Mapper entry point.
 * Combines Step 2 (Signals), Step 3 (Relationships), Step 4 (Lesson Grouping),
 * Step 5 (Topic Detection), Step 6 (Resource Mapping) into one Canonical Course representation.
 *
 * @param {Object} params - { courseMetadata, lessonGroupingResult, topicDetectionResult, resourceMappingResult, relationshipResult, blocksByFile }
 * @returns {Object} Canonical Course JSON
 */
function buildCanonicalCourse({
  courseMetadata = {},
  lessonGroupingResult = {},
  topicDetectionResult = {},
  resourceMappingResult = {},
  relationshipResult = {},
  blocksByFile = {}
} = {}) {
  const detectedLessons = topicDetectionResult.lessons || lessonGroupingResult.lessons || [];
  const mappedLessonResources = resourceMappingResult.lessonResources || [];
  const mappedModuleResources = resourceMappingResult.moduleResources || [];
  const mappedUnassignedResources = resourceMappingResult.unassignedResources || [];
  const topicBlockConservation = topicDetectionResult.blockConservation || {};
  const resourceConservation = resourceMappingResult.conservation || {};

  const meta = deriveCourseMetadata(courseMetadata, detectedLessons);

  const moduleKey = detectedLessons[0]?.moduleKey || "module:1";
  const rawModuleTitle = detectedLessons[0]?.title ? cleanText(detectedLessons[0].title.split("—")[1] || detectedLessons[0].title) : "Computer Fundamentals & Programming Concepts";
  const moduleTitle = rawModuleTitle || "Module 1: Core Concepts";

  let totalTopics = 0;
  let totalContents = 0;
  let totalLessonResources = 0;

  const canonicalLessons = detectedLessons.map((lesson, idx) => {
    const lessonKey = lesson.key;
    const rawTopics = lesson.topics || [];
    const topics = buildCanonicalTopics(rawTopics);
    totalTopics += topics.length;

    topics.forEach((t) => {
      totalContents += t.contents.length;
    });

    const lResObj = mappedLessonResources.find((lr) => lr.lessonKey === lessonKey);
    const resources = buildCanonicalResources(lResObj ? lResObj.resources : []);
    totalLessonResources += resources.length;

    return {
      key: lessonKey,
      moduleKey,
      title: cleanText(lesson.title),
      order: idx + 1,
      topics,
      resources,
      explainability: {
        confidence: lesson.confidence || "high",
        groupingReason: lesson.groupingReason || { type: "token_grouping", key: lessonKey }
      }
    };
  });

  const canonicalModuleResources = buildCanonicalResources(mappedModuleResources);

  const canonicalModule = {
    key: moduleKey,
    title: moduleTitle,
    order: 1,
    lessons: canonicalLessons,
    moduleResources: canonicalModuleResources,
    explainability: {
      confidence: "high",
      groupingReason: { type: "module_token_grouping", moduleKey }
    }
  };

  const conservation = {
    totalSourceFiles: resourceConservation.totalSourceFiles || 0,
    mappedSourceFiles: (resourceConservation.totalSourceFiles || 0) - (resourceConservation.unassignedResources || 0),
    unmappedSourceFiles: resourceConservation.unassignedResources || 0,
    duplicatedFiles: 0,

    totalSourceBlocks: topicBlockConservation.totalSourceBlocks || 0,
    mappedSourceBlocks: topicBlockConservation.assignedBlocks || 0,
    preambleBlocks: topicBlockConservation.preambleBlocks || 0,
    unmappedSourceBlocks: topicBlockConservation.lostBlocks || 0,
    duplicatedBlocks: 0,

    totalModules: 1,
    totalLessons: canonicalLessons.length,
    totalTopics,
    totalContents,
    totalLessonResources,
    totalModuleResources: canonicalModuleResources.length
  };

  return {
    title: meta.title,
    code: meta.code,
    description: meta.description,
    category: meta.category,
    level: meta.level,
    price: meta.price,
    currency: meta.currency,
    instructor: meta.instructor,

    modules: [canonicalModule],
    unmappedContent: mappedUnassignedResources,
    conservation
  };
}

module.exports = {
  cleanText,
  deriveCourseMetadata,
  mapCanonicalContents,
  buildCanonicalTopics,
  buildCanonicalResources,
  buildCanonicalCourse
};
