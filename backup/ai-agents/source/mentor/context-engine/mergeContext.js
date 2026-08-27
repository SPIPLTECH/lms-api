const { extractRankedSuggestions } = require("./suggestionNormalizers");
const { RECENT_ACTIVITY_EVENT_LIMIT } = require("../constants");

/**
 * "How should responses be merged?" — since every agent owns a disjoint
 * slice of context (no two agents report the same fact about the same
 * subject in this system), there's no fabricated conflict-resolution
 * engine here. Every value is provenance-labeled by agentName in `byAgent`
 * so the prompt (and the LLM) always knows which real system a fact came
 * from. The one place multiple agents' outputs genuinely compete for
 * attention — "you should do X"-shaped suggestions — is handled by
 * `rankedSuggestions`, which trusts each agent's own already-computed
 * urgency/impact/priority rather than second-guessing a peer's judgment.
 *
 * @param {import("../types/mentor.types").Actor} actor
 * @param {import("../types/mentor.types").AgentCallResult[]} agentResults
 * @param {{notifications: object[], calendarEvents: object[]}} raw
 * @returns {import("../types/mentor.types").MergedContext}
 */
const mergeContext = (actor, agentResults, raw) => {
  // Always keyed `${agentName}.${method}` — several agents are called with
  // more than one method in a single turn (e.g. assessment.getFullState AND
  // assessment.getKnowledgeGaps), so a bare agentName key would silently
  // overwrite one with the other. This exact key format is also what
  // suggestionNormalizers.js's NORMALIZERS map is keyed by.
  const byAgent = {};
  for (const result of agentResults) {
    byAgent[`${result.agentName}.${result.method}`] = result.status === "SUCCESS" ? result.data : null;
  }

  const eventLog = byAgent["observation.getStudentEventLog"];
  const recentActivity = Array.isArray(eventLog) ? eventLog.slice(-RECENT_ACTIVITY_EVENT_LIMIT).reverse() : [];

  return {
    actor,
    byAgent,
    recentActivity,
    notifications: raw.notifications,
    calendarEvents: raw.calendarEvents,
    rankedSuggestions: extractRankedSuggestions(agentResults),
    gatheredAt: new Date(),
  };
};

module.exports = { mergeContext };
