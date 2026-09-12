/**
 * Phase 11 — Step 5: Deterministic Topic Detection Layer
 * Pure utility/service with zero database dependencies.
 */

const { extractNumberedSection } = require("./signalExtractor.service");

// Keywords identifying practice, assignment, and task sections
const PRACTICE_KEYWORDS = [
  "mcqs",
  "mcq",
  "assignment",
  "home task",
  "hometask",
  "homework",
  "practice",
  "exercise"
];

/**
 * Helper to inspect markdown or html sourceElement to determine heading level and clean title text.
 */
function parseHeading(block) {
  if (!block) return null;

  let level = block.attributes?.sourceElement || block.sourceElement || block.level;
  let rawText = block.markdown || block.text || block.content || "";

  if (typeof level === "string") {
    level = level.toLowerCase();
  }

  if (rawText && typeof rawText === "string") {
    const mdMatch = rawText.match(/^(#{1,6})\s+(.*)$/);
    if (mdMatch) {
      if (!level) {
        level = `h${mdMatch[1].length}`;
      }
      rawText = mdMatch[2].trim();
    }
  }

  if (level && /^h[1-6]$/i.test(level)) {
    return {
      level: level.toLowerCase(),
      text: rawText.trim()
    };
  }

  return null;
}

/**
 * Clean heading text by removing markdown anchors, links, and extra spaces.
 */
function cleanHeadingText(text) {
  if (!text || typeof text !== "string") return "";
  return text.replace(/\[\]\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Determines if a heading is an H1 Day / Unit / Module Lesson boundary heading.
 */
function isDayLessonHeading(headingText, level) {
  if (level !== "h1") return false;
  return /\b(day|module|unit|week|session)s?\s*[-_]?\s*\d+\b/i.test(headingText);
}

/**
 * Determines if a heading is a Document Title H1 heading.
 */
function isDocumentTitleHeading(headingText, level, blockOrder) {
  if (level !== "h1") return false;
  if (blockOrder === 0) return true;
  return /\bmodule\s*[-_]?\s*\d+\s*:/i.test(headingText);
}

/**
 * Evaluates whether a heading is a candidate for a Topic.
 * Rules:
 * - Exclude Document Title H1
 * - Exclude Day/Unit H1 Lesson boundary headings
 * - Include numbered section headings (1.1, 1.2, 1.6)
 * - Include practice/MCQ headings
 * - Include other H2/H3 headings
 * Returns { isCandidate, type, numberedSection, title } or null.
 */
function inspectTopicHeading(block, blockOrder) {
  const headingInfo = parseHeading(block);
  if (!headingInfo) return null;

  const level = headingInfo.level;
  const rawText = cleanHeadingText(headingInfo.text);
  if (!rawText) return null;

  if (isDocumentTitleHeading(rawText, level, blockOrder)) {
    return { isCandidate: false, reason: "document_title_h1" };
  }

  if (isDayLessonHeading(rawText, level)) {
    return { isCandidate: false, reason: "day_lesson_boundary_h1" };
  }

  const numSecSignal = extractNumberedSection(rawText);
  if (numSecSignal) {
    const path = numSecSignal.sectionPath;
    if (path.length >= 3) {
      return { isCandidate: false, reason: "nested_subsection_depth_3" };
    }
    return {
      isCandidate: true,
      type: "numbered_heading",
      numberedSection: path,
      title: rawText,
      confidence: "high"
    };
  }

  const lowerText = rawText.toLowerCase();
  for (const kw of PRACTICE_KEYWORDS) {
    if (lowerText.includes(kw)) {
      return {
        isCandidate: true,
        type: `${kw.replace(/\s+/g, "")}_heading`,
        practiceKeyword: kw,
        title: rawText,
        confidence: "high"
      };
    }
  }

  if (level === "h2" || level === "h3") {
    const lowerText = rawText.toLowerCase();
    if (
      lowerText.includes("reference:") ||
      lowerText.startsWith("days 1-3") ||
      lowerText.startsWith("theory") ||
      lowerText.startsWith("practical")
    ) {
      return { isCandidate: false, reason: "overview_heading" };
    }
    return {
      isCandidate: true,
      type: "general_heading",
      title: rawText,
      confidence: "medium"
    };
  }

  return { isCandidate: false, reason: "other_heading" };
}

/**
 * Detects Topics for a single section of a file within a Lesson.
 * Preserves strict block conservation (0 lost, 0 duplicated blocks).
 * @param {Object} params - { sourceFile, relativePath, blocks, startBlockOrder, endBlockOrder }
 * @returns {Object} { topics: Array<Object>, preambleBlocks: Array<Object>, blockStats: Object }
 */
function detectTopicsForSection({
  sourceFile = "",
  relativePath = "",
  blocks = [],
  startBlockOrder = 0,
  endBlockOrder = null
} = {}) {
  if (!blocks || !blocks.length) {
    return { topics: [], preambleBlocks: [], blockStats: { total: 0, assigned: 0, preamble: 0, lost: 0, duplicated: 0 } };
  }

  const effectiveEnd = (endBlockOrder !== null && endBlockOrder !== undefined)
    ? Math.min(endBlockOrder, blocks.length - 1)
    : blocks.length - 1;

  const effectiveStart = Math.max(0, startBlockOrder);
  if (effectiveStart > effectiveEnd) {
    return { topics: [], preambleBlocks: [], blockStats: { total: 0, assigned: 0, preamble: 0, lost: 0, duplicated: 0 } };
  }

  const sectionBlocks = blocks.slice(effectiveStart, effectiveEnd + 1);

  const candidateHeadings = [];

  sectionBlocks.forEach((block, localIdx) => {
    const globalIdx = effectiveStart + localIdx;
    const inspection = inspectTopicHeading(block, globalIdx);

    if (inspection && inspection.isCandidate) {
      candidateHeadings.push({
        localIndex: localIdx,
        globalIndex: globalIdx,
        type: inspection.type,
        title: inspection.title,
        confidence: inspection.confidence,
        numberedSection: inspection.numberedSection || null,
        practiceKeyword: inspection.practiceKeyword || null
      });
    }
  });

  const topics = [];
  const preambleBlocks = [];
  let assignedCount = 0;

  if (candidateHeadings.length === 0) {
    return {
      topics: [],
      preambleBlocks: sectionBlocks,
      blockStats: {
        total: sectionBlocks.length,
        assigned: 0,
        preamble: sectionBlocks.length,
        lost: 0,
        duplicated: 0
      }
    };
  }

  const firstHeadingLocalIdx = candidateHeadings[0].localIndex;
  for (let i = 0; i < firstHeadingLocalIdx; i++) {
    preambleBlocks.push(sectionBlocks[i]);
  }

  candidateHeadings.forEach((heading, tIdx) => {
    const startLocal = heading.localIndex;
    const nextHeading = candidateHeadings[tIdx + 1];
    const endLocal = nextHeading ? nextHeading.localIndex - 1 : sectionBlocks.length - 1;

    const topicBlocks = sectionBlocks.slice(startLocal, endLocal + 1);
    assignedCount += topicBlocks.length;

    const startGlobalOrder = effectiveStart + startLocal;
    const endGlobalOrder = effectiveStart + endLocal;

    topics.push({
      key: `topic:${sourceFile}:${startGlobalOrder}`,
      title: heading.title,
      order: tIdx + 1,
      confidence: heading.confidence,
      sourceFile,
      relativePath: relativePath || sourceFile,
      startBlockOrder: startGlobalOrder,
      endBlockOrder: endGlobalOrder,
      blockCount: topicBlocks.length,
      numberedSection: heading.numberedSection,
      detectionReason: {
        type: heading.type,
        source: "heading",
        matchedText: heading.title,
        ...(heading.practiceKeyword ? { practiceKeyword: heading.practiceKeyword } : {})
      },
      blocks: topicBlocks
    });
  });

  const preambleCount = preambleBlocks.length;
  const totalSectionBlocks = sectionBlocks.length;
  const accounted = assignedCount + preambleCount;
  const lost = totalSectionBlocks - accounted;

  return {
    topics,
    preambleBlocks,
    blockStats: {
      total: totalSectionBlocks,
      assigned: assignedCount,
      preamble: preambleCount,
      lost: Math.max(0, lost),
      duplicated: 0
    }
  };
}

/**
 * Main Topic Detection entry point for Lesson groups.
 * Processes all members of each Lesson and generates Topic candidates while enforcing block conservation.
 * @param {Object} params - { lessonGroupingResult, blocksByFile }
 * @returns {Object} Processed lessons with topics and full block conservation metrics
 */
function detectTopicsForCourse({ lessonGroupingResult = {}, blocksByFile = {} } = {}) {
  const lessons = lessonGroupingResult.lessons || [];
  const moduleResources = lessonGroupingResult.moduleResources || [];
  const unassignedFiles = lessonGroupingResult.unassignedFiles || [];

  let overallSourceBlocks = 0;
  let overallAssignedBlocks = 0;
  let overallPreambleBlocks = 0;
  let overallLostBlocks = 0;

  const processedLessons = lessons.map((lesson) => {
    const members = lesson.members || [];
    const lessonTopics = [];
    let topicOrder = 1;

    // Filter members to only detect topics from primary content files (e.g. main theory DOCX)
    const primaryMembers = members.filter((member) => {
      const sourceFile = member.sourceFile || "";
      const lowerFile = sourceFile.toLowerCase();
      return lowerFile.includes("fundamentals") || lowerFile.includes("lecture_notes") || member.role === "primary";
    });

    const targetMembers = primaryMembers.length > 0 ? primaryMembers : members;

    targetMembers.forEach((member) => {
      const sourceFile = member.sourceFile;
      const fileBlocks = blocksByFile[sourceFile] || blocksByFile[member.relativePath] || [];

      let startOrder = 0;
      let endOrder = null;

      if (member.memberType === "section") {
        startOrder = member.startBlockOrder || 0;
        endOrder = member.endBlockOrder;
      }

      const sectionResult = detectTopicsForSection({
        sourceFile,
        relativePath: member.relativePath || sourceFile,
        blocks: fileBlocks,
        startBlockOrder: startOrder,
        endBlockOrder: endOrder
      });

      overallSourceBlocks += sectionResult.blockStats.total;
      overallAssignedBlocks += sectionResult.blockStats.assigned;
      overallPreambleBlocks += sectionResult.blockStats.preamble;
      overallLostBlocks += sectionResult.blockStats.lost;

      sectionResult.topics.forEach((t) => {
        lessonTopics.push({
          ...t,
          order: topicOrder++
        });
      });
    });

    return {
      ...lesson,
      topics: lessonTopics
    };
  });

  return {
    lessons: processedLessons,
    moduleResources,
    unassignedFiles,
    blockConservation: {
      totalSourceBlocks: overallSourceBlocks,
      assignedBlocks: overallAssignedBlocks,
      preambleBlocks: overallPreambleBlocks,
      duplicatedBlocks: 0,
      lostBlocks: overallLostBlocks
    }
  };
}

module.exports = {
  cleanHeadingText,
  parseHeading,
  isDayLessonHeading,
  isDocumentTitleHeading,
  inspectTopicHeading,
  detectTopicsForSection,
  detectTopicsForCourse
};
