/**
 * Phase 11 — Step 4: Deterministic Lesson Grouping Layer
 * Pure utility/service with zero database dependencies.
 */

/**
 * Cleans raw heading text or filename into a standard Lesson title.
 * Examples:
 *   "DAY 1: Computer Evolution, Architecture & Number Systems"
 *     -> "Day 1 — Computer Evolution, Architecture & Number Systems"
 *   "DAY 2: Boolean Algebra, Logic Gates & Storage"
 *     -> "Day 2 — Boolean Algebra, Logic Gates & Storage"
 *   "Slides_Day1_Computer_Evolution_Number_Systems.pptx"
 *     -> "Day 1 — Computer Evolution Number Systems"
 */
function formatLessonTitle(type, number, rawTitleText) {
  const capType = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  if (!rawTitleText || typeof rawTitleText !== "string") {
    return `${capType} ${number}`;
  }

  let cleaned = rawTitleText.trim();
  cleaned = cleaned.replace(/\.(docx?|pptx?|pdf|html?|txt)$/i, "");

  // Strip leading file role prefix (e.g. Slides_, Lecture_) if present before Day token
  cleaned = cleaned.replace(/^(?:slides|lecture|lesson|notes|tutorial)[_-]+/i, "");

  // Remove leading Day 1: / Day 1 - / DAY 1 / Module 1 prefix if present
  const prefixRegex = new RegExp(`^(?:${type}s?|${capType}s?)\\s*[-_]?\\s*${number}\\s*[:\\-_\\s]*`, "i");
  let stripped = cleaned.replace(prefixRegex, "").trim();

  // Replace underscores and hyphens with spaces for clean presentation
  stripped = stripped.replace(/[_-]+/g, " ").trim();

  if (stripped && stripped.length > 0) {
    return `${capType} ${number} — ${stripped}`;
  }

  return `${capType} ${number}`;
}

/**
 * Derives the strongest title for a Lesson group using heading & filename priority:
 * 1. H1 heading explicitly identifying the Day/Unit
 * 2. Strong H2 heading identifying the Day/Unit
 * 3. Filename-derived title
 * 4. Generic fallback ("Day N")
 */
function deriveLessonTitle(type, number, members = [], evidence = []) {
  const tokenKey = `${type}:${number}`;

  const h1Member = members.find(
    (m) => m.memberType === "section" && m.headingLevel === "h1" && m.matchedHeading
  );
  if (h1Member) {
    return formatLessonTitle(type, number, h1Member.matchedHeading);
  }

  const h1Ev = evidence.find(
    (e) => e.source === "heading" && e.headingLevel === "h1" && e.matchedText
  );
  if (h1Ev) {
    return formatLessonTitle(type, number, h1Ev.matchedText);
  }

  const h2Member = members.find(
    (m) => m.memberType === "section" && m.headingLevel === "h2" && m.matchedHeading
  );
  if (h2Member) {
    return formatLessonTitle(type, number, h2Member.matchedHeading);
  }

  const h2Ev = evidence.find(
    (e) => e.source === "heading" && e.headingLevel === "h2" && e.matchedText
  );
  if (h2Ev) {
    return formatLessonTitle(type, number, h2Ev.matchedText);
  }

  const fileMember = members.find((m) => m.memberType === "file" && m.sourceFile);
  if (fileMember) {
    return formatLessonTitle(type, number, fileMember.sourceFile);
  }

  const capType = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
  return `${capType} ${number}`;
}

/**
 * Main Lesson Grouping entry point.
 * Consumes relationship detector outputs and groups them into semantic Lessons & Module Resources.
 * @param {Object} detectorResult - { relationships: [], unassignedFiles: [] }
 * @returns {Object} { lessons: [], moduleResources: [], unassignedFiles: [] }
 */
function groupLessons(detectorResult = {}) {
  const relationships = detectorResult.relationships || [];
  const unassignedFiles = detectorResult.unassignedFiles || [];

  const lessons = [];
  const moduleResources = [];

  const lessonRelationships = relationships.filter((r) =>
    ["day", "unit", "week", "session"].includes(r.type)
  );

  const moduleRelationships = relationships.filter((r) => r.type === "module");

  const filesWithLesson = new Set();

  lessonRelationships.forEach((rel) => {
    const type = rel.type;
    const number = rel.number;
    const members = rel.members || [];
    const evidence = rel.evidence || [];

    members.forEach((m) => {
      if (m.sourceFile) {
        filesWithLesson.add(m.sourceFile);
      }
    });

    let moduleKey = null;
    moduleRelationships.forEach((mRel) => {
      const hasOverlap = mRel.members.some((mMemb) =>
        members.some((lMemb) => lMemb.sourceFile === mMemb.sourceFile)
      );
      if (hasOverlap && !moduleKey) {
        moduleKey = mRel.key;
      }
    });

    const title = deriveLessonTitle(type, number, members, evidence);

    lessons.push({
      key: rel.key,
      type: rel.type,
      number: rel.number,
      order: rel.number,
      moduleKey: moduleKey || "module:1",
      title,
      confidence: rel.confidence || "medium",
      groupingReason: {
        type: `shared_${type}_relationship`,
        token: rel.key,
        confidence: rel.confidence || "medium"
      },
      members: members.map((m) => ({
        memberType: m.memberType,
        sourceFile: m.sourceFile,
        relativePath: m.relativePath,
        ...(m.memberType === "section"
          ? {
              startBlockOrder: m.startBlockOrder,
              endBlockOrder: m.endBlockOrder,
              matchedHeading: m.matchedHeading
            }
          : {}),
        confidence: m.confidence
      }))
    });
  });

  lessons.sort((a, b) => a.order - b.order);

  moduleRelationships.forEach((mRel) => {
    mRel.members.forEach((member) => {
      if (!filesWithLesson.has(member.sourceFile)) {
        const alreadyAdded = moduleResources.some(
          (r) => r.sourceFile === member.sourceFile
        );
        if (!alreadyAdded) {
          moduleResources.push({
            memberType: "file",
            sourceFile: member.sourceFile,
            relativePath: member.relativePath,
            moduleKey: mRel.key,
            scope: "module",
            reason: "module relationship exists but no day relationship"
          });
        }
      }
    });
  });

  return {
    lessons,
    moduleResources,
    unassignedFiles
  };
}

module.exports = {
  formatLessonTitle,
  deriveLessonTitle,
  groupLessons
};
