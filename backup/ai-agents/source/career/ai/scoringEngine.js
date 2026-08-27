const { URGENCY_WEIGHT, IMPACT_WEIGHT, PRIORITY_HIGH_THRESHOLD, PRIORITY_MEDIUM_THRESHOLD, CAREER_PRIORITY } = require("../constants");
const { clamp, round2 } = require("../utils/scoreMath.util");

/**
 * Pure scoring function: combines a candidate's urgency/impact into a
 * single 0-100 score. Kept separate from ranking so each concern (score a
 * candidate vs. order/cap a list) is independently testable — same split
 * as Recommendation Agent's scoringEngine.js/rankingEngine.js.
 *
 * @param {import("../types/career.types").CareerCandidate} candidate
 * @returns {number} 0-100
 */
const computeScore = (candidate) => clamp(round2(candidate.urgency * URGENCY_WEIGHT + candidate.impact * IMPACT_WEIGHT));

/** @returns {string} CAREER_PRIORITY value */
const bucketPriority = (score) => {
  if (score >= PRIORITY_HIGH_THRESHOLD) return CAREER_PRIORITY.HIGH;
  if (score >= PRIORITY_MEDIUM_THRESHOLD) return CAREER_PRIORITY.MEDIUM;
  return CAREER_PRIORITY.LOW;
};

module.exports = { computeScore, bucketPriority };
