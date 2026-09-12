const { getBktParamsForKc, BKT_THRESHOLDS } = require("./bkt.config");

/**
 * Clamps a probability value strictly within [min, max].
 */
const clampProbability = (p) => {
  return Math.max(
    BKT_THRESHOLDS.PROBABILITY_MIN,
    Math.min(BKT_THRESHOLDS.PROBABILITY_MAX, p)
  );
};

/**
 * Calculates updated mastery probability using standard Bayesian Knowledge Tracing (BKT).
 *
 * @param {Object} params
 * @param {number} params.priorMastery - Previous mastery probability P(L_t-1)
 * @param {boolean} params.isCorrect - Observation signal (true for correct, false for incorrect)
 * @param {string} [params.kc] - Knowledge Component identifier (for parameter overrides)
 * @param {number} [params.attemptsCount=1] - Total attempts count including current
 * @returns {Object} BKT calculation results { newMastery, posteriorGivenObs, status, confidence, bktParams }
 */
const calculateBktUpdate = ({ priorMastery, isCorrect, kc, attemptsCount = 1 }) => {
  const bktParams = getBktParamsForKc(kc);
  const { pL0, pT, pG, pS } = bktParams;

  // Step 1: Establish prior P(L_t-1)
  const prior = typeof priorMastery === "number" ? clampProbability(priorMastery) : clampProbability(pL0);

  // Step 2: Calculate posterior P(L_t-1 | obs) using Bayes' Rule
  let posteriorGivenObs;
  if (isCorrect) {
    const numerator = prior * (1 - pS);
    const denominator = prior * (1 - pS) + (1 - prior) * pG;
    posteriorGivenObs = numerator / denominator;
  } else {
    const numerator = prior * pS;
    const denominator = prior * pS + (1 - prior) * (1 - pG);
    posteriorGivenObs = numerator / denominator;
  }

  // Step 3: Apply learning transition P(T)
  const rawNewMastery = posteriorGivenObs + (1 - posteriorGivenObs) * pT;
  const newMastery = Number(clampProbability(rawNewMastery).toFixed(4));

  // Step 4: Determine mastery status
  let status = "WEAK";
  if (newMastery >= BKT_THRESHOLDS.DEVELOPING_MAX) {
    status = "MASTERED";
  } else if (newMastery >= BKT_THRESHOLDS.WEAK_MAX) {
    status = "DEVELOPING";
  }

  // Step 5: Calculate confidence level based on evidence depth
  const rawConfidence = 1 - (1 - 0.1) * Math.pow(0.85, attemptsCount);
  const confidence = Number(Math.min(1.0, Math.max(0.1, rawConfidence)).toFixed(4));

  return {
    priorMastery: Number(prior.toFixed(4)),
    posteriorGivenObs: Number(posteriorGivenObs.toFixed(4)),
    newMastery,
    status,
    confidence,
    bktParams,
  };
};

module.exports = {
  clampProbability,
  calculateBktUpdate,
};
