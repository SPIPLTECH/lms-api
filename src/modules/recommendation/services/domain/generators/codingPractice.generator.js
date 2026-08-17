const { RECOMMENDATION_TYPE } = require("../../../constants");
const { clamp, round2 } = require("../../../utils/scoreMath.util");

/**
 * Documented domain gap (same one Assessment's evidenceExtractor notes):
 * this LMS has no coding-exercise catalog or EventType of its own. Coding
 * practice is inferred here by crossing an open KnowledgeGap concept with
 * an enrolled course whose category reads as programming-related — a
 * heuristic keyword match, not a real exercise lookup. The moment a coding-
 * exercise feature/model exists, this generator is the one file to replace.
 *
 * @param {import("../../../types/recommendation.types").StudentContext} context
 * @returns {import("../../../types/recommendation.types").Candidate[]}
 */
const CODING_CATEGORY_KEYWORDS = ["programming", "coding", "development", "software", "engineering"];

const isCodingCourse = (course) => {
  const haystack = `${course?.category || ""} ${course?.title || ""}`.toLowerCase();
  return CODING_CATEGORY_KEYWORDS.some((keyword) => haystack.includes(keyword));
};

const generate = (context) => {
  const gaps = context.assessment?.knowledgeGaps?.gaps || [];
  if (gaps.length === 0) return [];

  const codingEnrollment = (context.enrollments || []).find((e) => isCodingCourse(e.course));
  if (!codingEnrollment) return [];

  const topGap = [...gaps].sort((a, b) => b.severity - a.severity)[0];

  return [
    {
      type: RECOMMENDATION_TYPE.PRACTICE_CODING_CHALLENGE,
      dedupeKey: `${codingEnrollment.courseId}:${topGap.concept}`,
      reason: `Hands-on practice on "${topGap.concept}" reinforces it faster than review alone.`,
      urgency: clamp(round2(topGap.severity * 0.7)),
      impact: clamp(round2(topGap.severity * 0.8 + 10)),
      confidence: 55,
      estimatedTimeMinutes: 25,
      courseId: codingEnrollment.courseId,
      metadata: { concept: topGap.concept, exerciseType: "CODING" },
    },
  ];
};

module.exports = { generate };
