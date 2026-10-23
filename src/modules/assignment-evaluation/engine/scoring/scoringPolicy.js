'use strict';

/**
 * Every tunable number used by the scorer, in one place, so behaviour can be
 * adjusted (and tested) without touching the scoring logic. Pass overrides
 * through createRuleBasedEvaluator({ policy }).
 */
const DEFAULT_POLICY = Object.freeze({
  // Criterion satisfaction (0..1) at or above this earns full marks.
  fullCreditThreshold: 0.85,
  // Below this, the criterion earns nothing (one keyword out of three is not enough).
  minCreditThreshold: 0.35,

  // Similarity may nudge partial direct evidence upward, never create it.
  corroboration: Object.freeze({
    // Direct evidence needed before similarity counts at all. Equal to
    // minCreditThreshold so similarity can never turn zero marks into some.
    minDirect: 0.35,
    minSimilarity: 0.2,
    factor: 0.25,
    maxBoost: 0.15,
  }),

  // Direct evidence below minDirect but similarity at least this high: the student
  // may have paraphrased. No marks, but sent for review.
  paraphraseSimilarity: 0.35,
  // Direct evidence at least 0.6 but context similarity below this: keywords
  // present without the surrounding idea (possible keyword dropping).
  weakContextSimilarity: 0.08,

  // Caps applied when the evidence is internally inconsistent.
  orderMismatchCap: 0.5,
  mixedPolarityCap: 0.5,

  // Misconception phrases must match at least this closely (ordered overlap).
  misconceptionThreshold: 0.8,

  // Confidence model (starts at base, penalties subtract).
  confidence: Object.freeze({
    base: 0.95,
    borderline: 0.2,
    weakContext: 0.15,
    paraphrase: 0.45,
    fuzzy: 0.1,
    orderMismatch: 0.45,
    mixedPolarity: 0.45,
    contradiction: 0.6,
    autoRubric: 0.1,
    keywordList: 0.35,
    min: 0.05,
  }),
  reviewConfidenceThreshold: 0.6,

  // Answer-level checks.
  substantiveAnswerTokens: 15,
  substantiveLowScoreRatio: 0.3,
  offTopicSimilarity: 0.1,
  keywordList: Object.freeze({ maxStopwordRatio: 0.1, minMatchedKeywords: 3, maxSentences: 1 }),
});

function mergePolicy(overrides = {}) {
  const merged = { ...DEFAULT_POLICY, ...overrides };
  for (const key of ['corroboration', 'confidence', 'keywordList']) {
    merged[key] = { ...DEFAULT_POLICY[key], ...(overrides[key] || {}) };
  }
  return Object.freeze(merged);
}

const ALLOWED_MARK_STEPS = [0.25, 0.5, 1];

module.exports = { DEFAULT_POLICY, mergePolicy, ALLOWED_MARK_STEPS };
