const {
  URGENCY_WEIGHT,
  IMPACT_WEIGHT,
  PRIORITY_HIGH_THRESHOLD,
  PRIORITY_MEDIUM_THRESHOLD,
  RECOMMENDATION_PRIORITY,
} = require("../../constants");
const { clamp, round2 } = require("../../utils/scoreMath.util");

/**
 * Pure scoring function: combines a candidate's urgency/impact into a
 * single 0-100 score, then applies the feedback-derived damping/boost
 * multiplier for this (student, type) pair. Kept separate from ranking so
 * each concern (score a candidate vs. order/cap a list) is independently
 * testable.
 *
 * @param {import("../../types/recommendation.types").Candidate} candidate
 * @param {number} [adjustmentMultiplier] - from feedbackAdjustment.js, default 1 (no adjustment).
 * @returns {number} 0-100
 */
const computeScore = (candidate, adjustmentMultiplier = 1) => {
  const base = candidate.urgency * URGENCY_WEIGHT + candidate.impact * IMPACT_WEIGHT;
  return clamp(round2(base * adjustmentMultiplier));
};

/**
 * @param {number} score
 * @returns {string} RECOMMENDATION_PRIORITY value
 */
const bucketPriority = (score) => {
  if (score >= PRIORITY_HIGH_THRESHOLD) return RECOMMENDATION_PRIORITY.HIGH;
  if (score >= PRIORITY_MEDIUM_THRESHOLD) return RECOMMENDATION_PRIORITY.MEDIUM;
  return RECOMMENDATION_PRIORITY.LOW;
};

module.exports = { computeScore, bucketPriority };
