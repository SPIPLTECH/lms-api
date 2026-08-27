const {
  FEEDBACK_DAMPING_PER_NEGATIVE,
  FEEDBACK_MAX_DAMPING,
  FEEDBACK_BOOST_PER_POSITIVE,
  FEEDBACK_MAX_BOOST,
  FEEDBACK_ACTION,
} = require("../../constants");
const { clamp } = require("../../utils/scoreMath.util");

const NEGATIVE_ACTIONS = new Set([FEEDBACK_ACTION.NOT_HELPFUL, FEEDBACK_ACTION.DISMISSED]);
const POSITIVE_ACTIONS = new Set([FEEDBACK_ACTION.HELPFUL, FEEDBACK_ACTION.ACCEPTED, FEEDBACK_ACTION.COMPLETED]);

/**
 * Turns a student's recent feedback on a single recommendation type into a
 * multiplier applied to future candidates of that type: repeated dismissals
 * push it down, repeated positive engagement pushes it up. This is a
 * documented heuristic (linear counting), not a trained personalization
 * model — the RecommendationFeedback ledger exists so a real model could
 * replace this function later without touching anything else.
 *
 * @param {{action: string}[]} feedbackRows - most-recent-first, already scoped to one (student, type).
 * @returns {number} multiplier, roughly in [1 - FEEDBACK_MAX_DAMPING, 1 + FEEDBACK_MAX_BOOST]
 */
const computeAdjustmentMultiplier = (feedbackRows) => {
  if (!feedbackRows || feedbackRows.length === 0) return 1;

  let damping = 0;
  let boost = 0;

  for (const row of feedbackRows) {
    if (NEGATIVE_ACTIONS.has(row.action)) damping += FEEDBACK_DAMPING_PER_NEGATIVE;
    else if (POSITIVE_ACTIONS.has(row.action)) boost += FEEDBACK_BOOST_PER_POSITIVE;
  }

  damping = Math.min(damping, FEEDBACK_MAX_DAMPING);
  boost = Math.min(boost, FEEDBACK_MAX_BOOST);

  return clamp(1 - damping + boost, 1 - FEEDBACK_MAX_DAMPING, 1 + FEEDBACK_MAX_BOOST);
};

module.exports = { computeAdjustmentMultiplier };
