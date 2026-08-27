const { MEMORY_KEY } = require("../constants");

/**
 * Deterministic extraction into the fixed MEMORY_KEY vocabulary — every
 * fact here is read directly off an already-verified real field (see
 * career's toProfileResponse#primaryTargetRole), never inferred or
 * fabricated by an LLM. Returns only the facts this turn actually produced
 * — the repository upserts each key independently, so a turn that doesn't
 * touch career data simply leaves CAREER_GOAL unchanged.
 *
 * @param {import("../types/mentor.types").IntentResult} intentResult
 * @param {import("../types/mentor.types").MergedContext} mergedContext
 * @param {string} userMessage
 * @returns {Record<string, any>} memoryKey -> value
 */
const extractFacts = (intentResult, mergedContext, userMessage) => {
  const facts = {
    [MEMORY_KEY.LAST_INTENT]: { intent: intentResult.intent, at: new Date().toISOString() },
  };

  const careerState = mergedContext.byAgent["career.getFullState"];
  if (careerState?.primaryTargetRole) {
    facts[MEMORY_KEY.CAREER_GOAL] = {
      targetRoleId: careerState.primaryTargetRole.id,
      targetRoleTitle: careerState.primaryTargetRole.name,
      at: new Date().toISOString(),
    };
  }

  if (intentResult.intent === "LEARNING" && userMessage) {
    facts[MEMORY_KEY.LAST_STUDY_TOPIC] = { topic: userMessage.slice(0, 120), at: new Date().toISOString() };
  }

  return facts;
};

module.exports = { extractFacts };
