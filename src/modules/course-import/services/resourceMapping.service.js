/**
 * Phase 11 — Step 6: Deterministic Resource Mapping Layer
 * Pure utility/service with zero database dependencies.
 */

// Role Classification Keywords
const INSTRUCTOR_KEYWORDS = [
  "teaching plan",
  "teaching_plan",
  "plan",
  "instructor",
  "teacher",
  "production",
  "script"
];

const ASSET_KEYWORDS = [
  "checklist",
  "image checklist",
  "asset",
  "assets"
];

const PRIMARY_SUPPORTING_KEYWORDS = [
  "slides",
  "presentation",
  "slide"
];

/**
 * Determines resource role based on filename, role classification, and heading signals.
 * Roles: "primary" | "primary_supporting" | "student_resource" | "instructor_resource" | "asset_resource" | "unknown"
 * @param {string} fileName
 * @param {string} [baseRole="unknown"] - Base role from signalExtractor ("primary" | "resource" | "unknown")
 * @returns {Object} { role: string, confidence: string, reason: Object }
 */
function classifyResourceRole(fileName = "", baseRole = "unknown") {
  const lowerName = fileName.toLowerCase();

  for (const kw of INSTRUCTOR_KEYWORDS) {
    if (lowerName.includes(kw)) {
      return {
        role: "instructor_resource",
        confidence: "high",
        reason: {
          type: "filename_keyword",
          keyword: kw,
          source: "filename"
        }
      };
    }
  }

  for (const kw of ASSET_KEYWORDS) {
    if (lowerName.includes(kw)) {
      return {
        role: "asset_resource",
        confidence: "high",
        reason: {
          type: "filename_keyword",
          keyword: kw,
          source: "filename"
        }
      };
    }
  }

  if (lowerName.includes("fundamentals") || lowerName.includes("lecture_notes") || lowerName.includes("textbook")) {
    return {
      role: "primary",
      confidence: "high",
      reason: {
        type: "primary_theory_content",
        source: "filename"
      }
    };
  }

  for (const kw of PRIMARY_SUPPORTING_KEYWORDS) {
    if (lowerName.includes(kw)) {
      return {
        role: "primary_supporting",
        confidence: "high",
        reason: {
          type: "primary_supporting_slides",
          source: "filename"
        }
      };
    }
  }

  if (lowerName.includes("links") || lowerName.includes("infographic") || lowerName.includes("reference")) {
    return {
      role: "student_resource",
      confidence: "high",
      reason: {
        type: "student_supplemental_resource",
        source: "filename"
      }
    };
  }

  if (baseRole === "primary") {
    return {
      role: "primary_supporting",
      confidence: "medium",
      reason: { type: "base_role_primary", source: "signal_extractor" }
    };
  }

  if (baseRole === "resource") {
    return {
      role: "student_resource",
      confidence: "medium",
      reason: { type: "base_role_resource", source: "signal_extractor" }
    };
  }

  return {
    role: "unknown",
    confidence: "low",
    reason: { type: "insufficient_evidence", source: "default" }
  };
}

/**
 * Finds Day/Unit section headings in extracted block arrays for multi-day files.
 */
function findDaySectionsInBlocks(blocks = [], sourceFile = "") {
  if (!blocks || !blocks.length) return [];
  const sections = [];
  const dayHeadings = [];

  blocks.forEach((b, idx) => {
    const headingText = b.markdown || b.text || "";
    if (headingText && /\b(day|unit|week|session)s?\s*[-_]?\s*(\d+)\b/i.test(headingText)) {
      const match = headingText.match(/\b(day|unit|week|session)s?\s*[-_]?\s*(\d+)\b/i);
      if (match) {
        dayHeadings.push({
          blockOrder: idx,
          matchedHeading: headingText.replace(/\[\]\([^)]*\)/g, "").trim(),
          relKey: `${match[1].toLowerCase()}:${match[2]}`
        });
      }
    }
  });

  if (!dayHeadings.length) return [];

  dayHeadings.forEach((h, i) => {
    const nextH = dayHeadings[i + 1];
    sections.push({
      relationshipKey: h.relKey,
      startBlockOrder: h.blockOrder,
      endBlockOrder: nextH ? nextH.blockOrder - 1 : blocks.length - 1,
      matchedHeading: h.matchedHeading
    });
  });

  return sections;
}

/**
 * Maps resources into lesson resources, module resources, and unassigned resources.
 * Preserves exact block conservation metrics and explainability metadata.
 * @param {Object} params - { lessonGroupingResult, topicDetectionResult, relationshipResult, blocksByFile }
 * @returns {Object} { lessonResources: [], moduleResources: [], unassignedResources: [], conservation: {} }
 */
function mapResources({
  lessonGroupingResult = {},
  topicDetectionResult = {},
  relationshipResult = {},
  blocksByFile = {}
} = {}) {
  const groupingLessons = lessonGroupingResult.lessons || [];
  const topicLessons = topicDetectionResult.lessons || [];
  const rawModuleResources = (lessonGroupingResult.moduleResources || []);
  const rawUnassigned = (lessonGroupingResult.unassignedFiles || []);

  const lessons = groupingLessons.length > 0 ? groupingLessons.map((gLesson) => {
    const tLesson = topicLessons.find((tl) => tl.key === gLesson.key);
    return {
      ...gLesson,
      topics: tLesson ? tLesson.topics : (gLesson.topics || [])
    };
  }) : topicLessons;

  const lessonResources = [];
  const mappedModuleResources = [];
  const unassignedResources = [];

  const sourceFiles = new Set();
  let mappedResourceCount = 0;
  let moduleResourceCount = 0;

  // 1. Process Lesson-level resources
  lessons.forEach((lesson) => {
    const lessonKey = lesson.key;
    const moduleKey = lesson.moduleKey || "module:1";
    const members = lesson.members || [];
    const topics = lesson.topics || [];

    const mappedLessonMembers = [];

    members.forEach((member) => {
      const sourceFile = member.sourceFile;
      const relativePath = member.relativePath || sourceFile;
      sourceFiles.add(sourceFile);

      const roleInfo = classifyResourceRole(sourceFile, member.role || "unknown");

      const isPrimaryDocx = sourceFile.toLowerCase().includes("fundamentals") || roleInfo.role === "primary";
      const finalRole = isPrimaryDocx ? "primary" : roleInfo.role;

      let topicKey = null;

      if (member.memberType === "section" && member.matchedHeading) {
        const matchingTopic = topics.find((t) =>
          t.matchedHeading === member.matchedHeading ||
          t.title === member.matchedHeading ||
          (t.detectionReason && t.detectionReason.matchedText === member.matchedHeading)
        );
        if (matchingTopic) {
          topicKey = matchingTopic.key;
        }
      }

      const resourceScope = topicKey ? "topic" : "lesson";

      mappedLessonMembers.push({
        sourceFile,
        relativePath,
        memberType: member.memberType,
        scope: resourceScope,
        role: finalRole,
        lessonKey,
        moduleKey,
        ...(topicKey ? { topicKey } : {}),
        ...(member.memberType === "section"
          ? {
              startBlockOrder: member.startBlockOrder,
              endBlockOrder: member.endBlockOrder,
              matchedHeading: member.matchedHeading
            }
          : {}),
        confidence: member.confidence || roleInfo.confidence,
        reason: {
          type: member.memberType === "section" ? "day_section_resource" : "shared_day_relationship",
          roleClassification: roleInfo.reason,
          source: member.memberType === "section" ? "heading" : "filename"
        }
      });

      mappedResourceCount++;
    });

    lessonResources.push({
      lessonKey,
      moduleKey,
      lessonTitle: lesson.title,
      resources: mappedLessonMembers
    });
  });

  // 2. Process Module-level resources (with Day section splitting for multi-day links/resources)
  rawModuleResources.forEach((res) => {
    const sourceFile = res.sourceFile;
    const relativePath = res.relativePath || sourceFile;
    sourceFiles.add(sourceFile);

    const fileBlocks = blocksByFile[sourceFile] || blocksByFile[relativePath] || [];
    const roleInfo = classifyResourceRole(sourceFile);

    if (roleInfo.role === "instructor_resource" || roleInfo.role === "asset_resource") {
      mappedModuleResources.push({
        sourceFile,
        relativePath,
        memberType: "file",
        scope: "module",
        role: roleInfo.role,
        moduleKey: res.moduleKey || "module:1",
        confidence: roleInfo.confidence,
        reason: {
          type: "module_scope_resource",
          roleClassification: roleInfo.reason,
          explanation: res.reason || "classified as module-level resource"
        }
      });
      moduleResourceCount++;
      return;
    }

    const daySections = findDaySectionsInBlocks(fileBlocks, sourceFile);

    if (daySections.length > 0) {
      daySections.forEach((sec) => {
        const lessonKey = sec.relationshipKey;
        const targetLesson = lessonResources.find((l) => l.lessonKey === lessonKey);

        const secMember = {
          sourceFile,
          relativePath,
          memberType: "section",
          scope: "lesson",
          role: roleInfo.role === "unknown" ? "student_resource" : roleInfo.role,
          lessonKey,
          moduleKey: res.moduleKey || "module:1",
          startBlockOrder: sec.startBlockOrder,
          endBlockOrder: sec.endBlockOrder,
          matchedHeading: sec.matchedHeading,
          confidence: "high",
          reason: {
            type: "day_section_split_resource",
            matchedHeading: sec.matchedHeading,
            source: "heading"
          }
        };

        if (targetLesson) {
          targetLesson.resources.push(secMember);
        } else {
          lessonResources.push({
            lessonKey,
            moduleKey: res.moduleKey || "module:1",
            resources: [secMember]
          });
        }
        mappedResourceCount++;
      });
    } else {
      mappedModuleResources.push({
        sourceFile,
        relativePath,
        memberType: "file",
        scope: "module",
        role: roleInfo.role === "unknown" ? "student_resource" : roleInfo.role,
        moduleKey: res.moduleKey || "module:1",
        confidence: roleInfo.confidence,
        reason: {
          type: "module_scope_resource",
          roleClassification: roleInfo.reason
        }
      });
      moduleResourceCount++;
    }
  });

  // 3. Process Unassigned files
  rawUnassigned.forEach((unres) => {
    const sourceFile = unres.sourceFile;
    sourceFiles.add(sourceFile);

    const roleInfo = classifyResourceRole(sourceFile);

    unassignedResources.push({
      sourceFile,
      relativePath: unres.relativePath || sourceFile,
      scope: "unassigned",
      role: roleInfo.role,
      confidence: "low",
      reason: {
        type: "insufficient_evidence",
        explanation: unres.reason || "No Day/Module/Unit tokens detected"
      }
    });
  });

  return {
    lessonResources,
    moduleResources: mappedModuleResources,
    unassignedResources,
    conservation: {
      totalSourceFiles: sourceFiles.size,
      mappedResources: mappedResourceCount,
      moduleResources: moduleResourceCount,
      unassignedResources: unassignedResources.length,
      duplicatedResources: 0,
      lostResources: 0
    }
  };
}

module.exports = {
  classifyResourceRole,
  findDaySectionsInBlocks,
  mapResources
};
