/**
 * Bayesian Knowledge Tracing (BKT) Configuration.
 *
 * Defines baseline initial parameters, transition probabilities, and classification thresholds.
 * Note: These are initial default parameters and can be overridden per Knowledge Component (KC)
 * or via environment variables as empirical calibration data becomes available.
 */

const DEFAULT_BKT_PARAMS = {
  // P(L0): Initial probability of knowing the concept before any evidence
  pL0: Number(process.env.BKT_DEFAULT_P_L0) || 0.2,
  // P(T): Probability of learning/transitioning to known state after an attempt
  pT: Number(process.env.BKT_DEFAULT_P_T) || 0.15,
  // P(G): Probability of guessing the correct answer despite not knowing
  pG: Number(process.env.BKT_DEFAULT_P_G) || 0.2,
  // P(S): Probability of slipping (making a mistake) despite knowing
  pS: Number(process.env.BKT_DEFAULT_P_S) || 0.1,
};

// KC-specific parameter overrides (for future empirical tuning)
const KC_PARAM_OVERRIDES = {};

/**
 * Returns the effective BKT parameters for a given KC.
 */
const getBktParamsForKc = (kc) => {
  if (kc && KC_PARAM_OVERRIDES[kc]) {
    return { ...DEFAULT_BKT_PARAMS, ...KC_PARAM_OVERRIDES[kc] };
  }
  return { ...DEFAULT_BKT_PARAMS };
};

const BKT_THRESHOLDS = {
  WEAK_MAX: 0.5,
  DEVELOPING_MAX: 0.85,
  PROBABILITY_MIN: 0.0001,
  PROBABILITY_MAX: 0.9999,
};

module.exports = {
  DEFAULT_BKT_PARAMS,
  KC_PARAM_OVERRIDES,
  getBktParamsForKc,
  BKT_THRESHOLDS,
};
