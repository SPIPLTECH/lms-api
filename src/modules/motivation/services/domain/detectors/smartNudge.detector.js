const { MOTIVATION_ACTION_TYPE, MOTIVATION_PRIORITY } = require("../../../constants");

/**
 * SMART_NUDGE: the clearest bridge from Recommendation Agent's output into
 * a motivational trigger — when Recommendation has active HIGH-priority
 * items, this nudges the student toward acting on them, framed around
 * their own preferred learning hour when known. Deliberately doesn't
 * duplicate Recommendation's content details, just points at the fact that
 * action is waiting.
 *
 * @param {import("../../../types/motivation.types").StudentContext} context
 * @returns {import("../../../types/motivation.types").MotivationCandidate[]}
 */
const detect = (context) => {
  const recommendations = context.recommendation?.recommendations || [];
  const highPriority = recommendations.filter((r) => r.priority === "HIGH");
  if (highPriority.length === 0) return [];

  const preferredHour = context.learningState?.behavior?.preferredLearningHour;
  const timeHint = typeof preferredHour === "number" ? ` — usually your best time to study is around ${preferredHour}:00.` : ".";

  return [
    {
      type: MOTIVATION_ACTION_TYPE.SMART_NUDGE,
      dedupeKey: "general",
      priority: highPriority.length >= 3 ? MOTIVATION_PRIORITY.HIGH : MOTIVATION_PRIORITY.MEDIUM,
      triggerReason: `You have ${highPriority.length} high-priority recommendation(s) waiting${timeHint}`,
      confidence: 65,
      recommendedAt: context.now,
      metadata: { highPriorityCount: highPriority.length, preferredLearningHour: preferredHour ?? null },
    },
  ];
};

module.exports = { detect };
