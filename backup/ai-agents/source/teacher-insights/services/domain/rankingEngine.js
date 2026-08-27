const { PRIORITY_RANK } = require("../../constants");

/**
 * The "Rank Priority Issues" step from the business-logic diagram — unlike
 * Recommendation/Motivation, this agent's detectors don't need a shared
 * numeric score (each decides its own priority directly, same rule-based
 * approach as Motivation), but the *output ordering* genuinely matters for
 * a teacher's dashboard: most urgent first. Pure, stable sort — doesn't
 * mutate or cap the input list, since (unlike Recommendation) nothing here
 * competes for a limited slot.
 *
 * @param {Array<{priority: string, confidence?: number, confidenceScore?: number}>} candidates
 */
const rankInsights = (candidates) => {
  return [...candidates].sort((a, b) => {
    const priorityDelta = (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0);
    if (priorityDelta !== 0) return priorityDelta;
    const confidenceA = a.confidence ?? a.confidenceScore ?? 0;
    const confidenceB = b.confidence ?? b.confidenceScore ?? 0;
    return confidenceB - confidenceA;
  });
};

module.exports = { rankInsights };
