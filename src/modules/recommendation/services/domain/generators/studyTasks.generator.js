const { RECOMMENDATION_TYPE, DAILY_TASKS_MAX_ITEMS } = require("../../../constants");

/**
 * DAILY_LEARNING_TASKS is a synthesis, not an independent signal: it
 * bundles the top few already-generated candidates (by urgency) into one
 * "here's your plan for today" recommendation. Runs after every other
 * generator — see generators/index.js — so it always reflects the same
 * ranked reality the individual recommendations do, rather than
 * recomputing its own view of what matters.
 *
 * @param {import("../../../types/recommendation.types").StudentContext} context
 * @param {import("../../../types/recommendation.types").Candidate[]} priorCandidates
 * @returns {import("../../../types/recommendation.types").Candidate[]}
 */
const generate = (context, priorCandidates) => {
  if (!priorCandidates || priorCandidates.length === 0) return [];

  const top = [...priorCandidates].sort((a, b) => b.urgency - a.urgency).slice(0, DAILY_TASKS_MAX_ITEMS);

  const estimatedTimeMinutes = top.reduce((sum, c) => sum + (c.estimatedTimeMinutes || 10), 0);
  const avgUrgency = top.reduce((sum, c) => sum + c.urgency, 0) / top.length;

  return [
    {
      type: RECOMMENDATION_TYPE.DAILY_LEARNING_TASKS,
      dedupeKey: "daily",
      reason: `Today's focus: ${top.map((c) => c.type.replace(/_/g, " ").toLowerCase()).join(", ")}.`,
      urgency: avgUrgency,
      impact: 50,
      confidence: 70,
      estimatedTimeMinutes,
      metadata: { tasks: top.map((c) => ({ type: c.type, dedupeKey: c.dedupeKey, reason: c.reason })) },
    },
  ];
};

module.exports = { generate };
