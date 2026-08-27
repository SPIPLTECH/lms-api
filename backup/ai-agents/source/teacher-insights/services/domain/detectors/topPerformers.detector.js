const { ALERT_TYPE, INSIGHT_PRIORITY, TOP_PERFORMER_SCORE, TOP_PERFORMER_MAX_RISK } = require("../../../constants");

/**
 * TOP_PERFORMER: recognition, not risk — high performance AND engagement
 * AND low dropout risk, all three required so a student who's merely
 * "not at risk" doesn't get miscounted as excelling.
 *
 * @param {import("../../../types/teacherInsight.types").CourseContext} context
 * @returns {import("../../../types/teacherInsight.types").StudentAlertCandidate[]}
 */
const detect = (context) => {
  return context.studentStates
    .filter((state) => {
      const performance = state.scores?.performanceScore || 0;
      const engagement = state.scores?.engagementScore || 0;
      const risk = state.risk?.dropoutRiskScore || 0;
      return performance >= TOP_PERFORMER_SCORE && engagement >= TOP_PERFORMER_SCORE && risk <= TOP_PERFORMER_MAX_RISK;
    })
    .map((state) => ({
      alertType: ALERT_TYPE.TOP_PERFORMER,
      studentId: state.studentId,
      priority: INSIGHT_PRIORITY.LOW,
      reason: `Performance ${Math.round(state.scores.performanceScore)} and engagement ${Math.round(state.scores.engagementScore)}, low dropout risk.`,
      confidence: 80,
      evidence: { performanceScore: state.scores.performanceScore, engagementScore: state.scores.engagementScore },
    }));
};

module.exports = { detect };
