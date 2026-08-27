const { ALERT_TYPE, INSIGHT_PRIORITY, AT_RISK_DROPOUT_SCORE } = require("../../../constants");

/**
 * AT_RISK: directly from Student State's already-computed dropout risk —
 * this detector never re-derives risk itself, it only surfaces Student
 * State's authoritative signal at the class level for the instructor.
 *
 * @param {import("../../../types/teacherInsight.types").CourseContext} context
 * @returns {import("../../../types/teacherInsight.types").StudentAlertCandidate[]}
 */
const detect = (context) => {
  return context.studentStates
    .filter((state) => (state.risk?.dropoutRiskScore || 0) >= AT_RISK_DROPOUT_SCORE)
    .map((state) => ({
      alertType: ALERT_TYPE.AT_RISK,
      studentId: state.studentId,
      priority: state.risk.dropoutRiskLevel === "HIGH" ? INSIGHT_PRIORITY.HIGH : INSIGHT_PRIORITY.MEDIUM,
      reason: `Dropout risk is ${state.risk.dropoutRiskLevel} (score ${Math.round(state.risk.dropoutRiskScore)}).`,
      confidence: 85,
      evidence: { dropoutRiskScore: state.risk.dropoutRiskScore, dropoutRiskLevel: state.risk.dropoutRiskLevel },
    }));
};

module.exports = { detect };
