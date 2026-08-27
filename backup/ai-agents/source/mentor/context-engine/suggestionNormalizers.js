const PRIORITY_TO_URGENCY = Object.freeze({ HIGH: 90, MEDIUM: 60, LOW: 30 });

/**
 * Only two agents' result shapes are normalized into rankedSuggestions —
 * both verified directly against their own DTO source in this same
 * codebase, not guessed. Every other agent's raw result still reaches the
 * prompt via `byAgent`, it just doesn't compete in the ranked list — an
 * honest limitation, not a silent gap (see mergeContext.js's doc comment).
 *
 * @type {Record<string, (data: any) => Array<{source: string, type: string, title: string, urgency: number, impact: number, confidenceScore: number}>>}
 */
const NORMALIZERS = {
  "recommendation.getByStudent": (data) =>
    (data?.recommendations || []).map((r) => ({
      source: "recommendation",
      type: r.type,
      title: r.reason,
      urgency: PRIORITY_TO_URGENCY[r.priority] ?? 50,
      impact: r.score ?? 50,
      confidenceScore: r.confidenceScore ?? 50,
    })),
  "admin-intelligence.getDashboard": (data) =>
    (data?.recommendations || []).map((r) => ({
      source: "admin-intelligence",
      type: r.type,
      title: r.title,
      urgency: r.urgency,
      impact: r.impact,
      confidenceScore: r.confidenceScore,
    })),
};

/**
 * @param {import("../types/mentor.types").AgentCallResult[]} results
 */
const extractRankedSuggestions = (results) => {
  const suggestions = [];
  for (const result of results) {
    const normalizer = NORMALIZERS[`${result.agentName}.${result.method}`];
    if (normalizer && result.status === "SUCCESS" && result.data) {
      suggestions.push(...normalizer(result.data));
    }
  }
  return suggestions.sort((a, b) => b.urgency * b.impact - a.urgency * a.impact);
};

module.exports = { extractRankedSuggestions };
