/**
 * Misconception Detection Engine Configuration.
 *
 * Defines evidence accumulation weights, decay parameters, and resolution thresholds.
 */

const MISCONCEPTION_CONFIG = {
  // Initial weight added on first incorrect answer (Weak Evidence baseline)
  INITIAL_INCORRECT_WEIGHT: 0.12,

  // Additional weight added when high hint count (hintsUsed >= 2) accompanies an error
  HIGH_HINT_PENALTY: 0.05,

  // Multiplier bonus added for consecutive repeated errors on the same KC
  CONSECUTIVE_ERROR_BONUS: 0.15,

  // Bonus weight when the same explicit hypothesis is repeated on an ACTIVE OPEN gap
  HYPOTHESIS_ALIGNMENT_BONUS: 0.08,

  // Decay amount subtracted on a successful/correct attempt (Recovery)
  RECOVERY_DECAY: 0.20,

  // Additional decay bonus when attempt is clean (score >= 0.85 with 0 hints)
  CLEAN_SUCCESS_BONUS: 0.10,

  // Threshold above which a misconception is persisted with status "OPEN"
  OPEN_THRESHOLD: 0.35,

  // Threshold below which an OPEN misconception transitions to "CLOSED"
  RESOLVE_THRESHOLD: 0.25,

  // Min and Max bounds for misconception probability
  MIN_PROBABILITY: 0.0,
  MAX_PROBABILITY: 0.95,
};

module.exports = {
  MISCONCEPTION_CONFIG,
};
