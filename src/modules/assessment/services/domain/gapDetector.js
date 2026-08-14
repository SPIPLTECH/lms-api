const { WEAK_SCORE_THRESHOLD } = require("../../constants");
const { clamp, round2 } = require("../../utils/scoreMath.util");

/**
 * Pure decision, evaluated fresh from the *current* mastery score every
 * time (not a before/after diff) — idempotent by construction, so
 * concurrent updates or replay can never leave a gap stuck in the wrong
 * state. The repository layer does the idempotent upsert/close.
 *
 * @param {number} masteryScore
 * @returns {{action: "ENSURE_OPEN"|"ENSURE_CLOSED", severity: number}}
 */
const evaluateGap = (masteryScore) => {
  if (masteryScore < WEAK_SCORE_THRESHOLD) {
    const severity = round2(clamp(WEAK_SCORE_THRESHOLD - masteryScore, 0, 100));
    return { action: "ENSURE_OPEN", severity };
  }
  return { action: "ENSURE_CLOSED", severity: 0 };
};

module.exports = { evaluateGap };
