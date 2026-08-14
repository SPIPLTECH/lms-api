const { MOTIVATION_ACTION_TYPE, MOTIVATION_PRIORITY } = require("../../../constants");

/**
 * REVISION_REMINDER: surfaces Assessment's own reassessment plan once a
 * concept is DUE — this agent never decides what to reassess or when
 * (Assessment owns that), it only nudges the student to actually go do it.
 *
 * @param {import("../../../types/motivation.types").StudentContext} context
 * @returns {import("../../../types/motivation.types").MotivationCandidate[]}
 */
const detect = (context) => {
  const plan = context.assessment?.reassessmentPlan?.plan || [];
  const due = plan.filter((entry) => entry.status === "DUE");

  return due.map((entry) => ({
    type: MOTIVATION_ACTION_TYPE.REVISION_REMINDER,
    dedupeKey: entry.id,
    priority: entry.priority === "HIGH" ? MOTIVATION_PRIORITY.HIGH : MOTIVATION_PRIORITY.MEDIUM,
    triggerReason: `"${entry.concept}" is due for revision (${entry.reason}).`,
    confidence: 80,
    recommendedAt: context.now,
    metadata: { concept: entry.concept, reassessmentPlanId: entry.id },
  }));
};

module.exports = { detect };
