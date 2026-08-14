const { TEACHING_RECOMMENDATION_TYPE, INSIGHT_PRIORITY, COURSE_INSIGHT_TYPE } = require("../../../constants");

/**
 * TEACHING_SUGGESTION: content-improvement ideas, softer and more
 * exploratory than INSTRUCTOR_ACTION's direct calls-to-action — one per
 * problematic lesson/quiz/assignment already surfaced by the CourseInsight
 * detectors, translated into a concrete suggestion.
 *
 * @param {import("../../../types/teacherInsight.types").CourseContext} context
 * @param {{studentAlerts: Object[], courseInsights: Object[]}} priorCandidates
 * @returns {import("../../../types/teacherInsight.types").TeachingRecommendationCandidate[]}
 */
const SUGGESTION_BY_TYPE = {
  [COURSE_INSIGHT_TYPE.LESSON_COMPLETION_TREND]: (insight) =>
    `Consider shortening "${insight.title.replace(/^"|" has.*$/g, "")}" or adding a video summary — completion is low.`,
  [COURSE_INSIGHT_TYPE.QUIZ_PERFORMANCE_TREND]: (insight) => `Review question difficulty/wording for "${insight.dedupeKey}" — pass rate is low.`,
  [COURSE_INSIGHT_TYPE.ASSIGNMENT_PERFORMANCE_TREND]: (insight) => `Review instructions or the deadline for this assignment — submission rate is low.`,
};

const detect = (context, { courseInsights }) => {
  return courseInsights
    .filter((insight) => SUGGESTION_BY_TYPE[insight.insightType])
    .map((insight) => ({
      recommendationType: TEACHING_RECOMMENDATION_TYPE.TEACHING_SUGGESTION,
      dedupeKey: `${insight.insightType}:${insight.dedupeKey}`,
      priority: insight.priority === INSIGHT_PRIORITY.HIGH ? INSIGHT_PRIORITY.MEDIUM : INSIGHT_PRIORITY.LOW,
      suggestedAction: SUGGESTION_BY_TYPE[insight.insightType](insight),
      reason: insight.reason,
      confidence: 60,
      affectedStudentCount: insight.affectedStudentCount,
      evidence: { sourceInsightType: insight.insightType, sourceDedupeKey: insight.dedupeKey },
    }));
};

module.exports = { detect };
