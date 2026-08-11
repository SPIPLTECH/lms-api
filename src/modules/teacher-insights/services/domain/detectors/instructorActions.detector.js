const { TEACHING_RECOMMENDATION_TYPE, INSIGHT_PRIORITY, ALERT_TYPE, STRUGGLING_OPEN_GAP_COUNT } = require("../../../constants");

/**
 * INSTRUCTOR_ACTION: concrete, student-facing actions the instructor
 * should take, cross-referencing the already-computed StudentAlert and
 * CourseInsight candidates rather than re-deriving anything — this
 * detector's whole job is synthesis, not new signal detection.
 *
 * @param {import("../../../types/teacherInsight.types").CourseContext} context
 * @param {{studentAlerts: Object[], courseInsights: Object[]}} priorCandidates
 * @returns {import("../../../types/teacherInsight.types").TeachingRecommendationCandidate[]}
 */
const detect = (context, { studentAlerts }) => {
  const candidates = [];

  const atRisk = studentAlerts.filter((a) => a.alertType === ALERT_TYPE.AT_RISK);
  if (atRisk.length > 0) {
    candidates.push({
      recommendationType: TEACHING_RECOMMENDATION_TYPE.INSTRUCTOR_ACTION,
      dedupeKey: "at-risk-checkins",
      priority: atRisk.length >= 3 ? INSIGHT_PRIORITY.HIGH : INSIGHT_PRIORITY.MEDIUM,
      suggestedAction: `Reach out to ${atRisk.length} at-risk student(s) with a 1:1 check-in.`,
      reason: `${atRisk.length} student(s) are currently flagged at-risk of dropping out.`,
      confidence: 80,
      affectedStudentCount: atRisk.length,
      evidence: { studentIds: atRisk.map((a) => a.studentId) },
    });
  }

  const struggling = studentAlerts.filter((a) => a.alertType === ALERT_TYPE.STRUGGLING);
  if (struggling.length >= STRUGGLING_OPEN_GAP_COUNT) {
    candidates.push({
      recommendationType: TEACHING_RECOMMENDATION_TYPE.INSTRUCTOR_ACTION,
      dedupeKey: "struggling-review-session",
      priority: INSIGHT_PRIORITY.MEDIUM,
      suggestedAction: `Consider a review session — ${struggling.length} student(s) are struggling with multiple concepts.`,
      reason: `${struggling.length} student(s) have several open knowledge gaps.`,
      confidence: 70,
      affectedStudentCount: struggling.length,
      evidence: { studentIds: struggling.map((a) => a.studentId) },
    });
  }

  return candidates;
};

module.exports = { detect };
