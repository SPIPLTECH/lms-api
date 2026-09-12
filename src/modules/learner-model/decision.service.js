const {
  PEDAGOGICAL_STRATEGIES,
  DECISION_PRIORITY,
  DECISION_CONFIG,
} = require("./decision.config");

/**
 * Deterministically evaluates normalized learner context and selects a Pedagogical Strategy.
 *
 * @param {Object} context - Normalized learner context
 * @param {string} context.kc - Knowledge Component identifier
 * @param {Object|null} context.kcState - ConceptMastery state object or null
 * @param {Object|null} context.misconception - Active KnowledgeGap object or null
 * @param {Object|null} [context.learningContext] - Current course/module/lesson context
 * @param {boolean} [context.hasNextTarget=false] - Whether a next curriculum target is available
 * @returns {Object} Normalized decision contract
 */
const evaluatePedagogicalDecision = ({
  kc,
  kcState,
  misconception,
  learningContext,
  hasNextTarget = false,
}) => {
  const masteryProbability = kcState ? kcState.masteryProbability : 0.20;
  const confidence = kcState ? kcState.confidence : 0.10;
  const attemptsCount = kcState ? kcState.attemptsCount : 0;
  const recentScores = kcState && Array.isArray(kcState.recentScores) ? kcState.recentScores : [];

  // Formulate misconception sub-object for response contract
  const misconceptionContract = misconception
    ? {
        hypothesis: misconception.hypothesis || misconception.concept,
        probability: misconception.probability ?? misconception.severity,
        status: misconception.status,
      }
    : null;

  const isActiveMisconception =
    misconception &&
    misconception.status === "OPEN" &&
    (misconception.probability ?? misconception.severity) >= DECISION_CONFIG.MISCONCEPTION_ACTIVE_THRESHOLD;

  // Check for recent degradation: calculate prior mastery if available from recent scores
  let isDegraded = false;
  if (recentScores.length >= 3) {
    const priorAverage =
      recentScores.slice(0, Math.max(1, recentScores.length - 2)).reduce((acc, s) => acc + (s.score || 0), 0) /
      Math.max(1, recentScores.length - 2);

    const recentFailures = recentScores.slice(-2).filter((s) => !s.isCorrect).length;

    if (priorAverage >= 0.70 && (masteryProbability < 0.60 || recentFailures >= 2)) {
      isDegraded = true;
    }
  }

  // --------------------------------------------------
  // RULE EVALUATION ENGINE (EXPLICIT PRIORITY ORDER)
  // --------------------------------------------------

  // Priority 1: Active High-Confidence Misconception
  if (isActiveMisconception) {
    return {
      strategy: PEDAGOGICAL_STRATEGIES.MISCONCEPTION_REMEDIATION,
      reason: "Active high-confidence misconception detected for knowledge component.",
      priority: DECISION_PRIORITY.HIGH,
      kc,
      masteryProbability,
      confidence,
      misconception: misconceptionContract,
    };
  }

  // Priority 2: Recent Mastery Degradation
  if (isDegraded) {
    return {
      strategy: PEDAGOGICAL_STRATEGIES.REVIEW,
      reason: "Recent performance indicates significant mastery degradation from prior understanding.",
      priority: DECISION_PRIORITY.HIGH,
      kc,
      masteryProbability,
      confidence,
      misconception: misconceptionContract,
    };
  }

  // Unassessed or zero attempt state -> Base remediation
  if (!kcState || kcState.status === "UNASSESSED" || attemptsCount === 0) {
    return {
      strategy: PEDAGOGICAL_STRATEGIES.CONCEPT_REMEDIATION,
      reason: "Knowledge component is unassessed; initial concept introduction recommended.",
      priority: DECISION_PRIORITY.MEDIUM,
      kc,
      masteryProbability,
      confidence,
      misconception: misconceptionContract,
    };
  }

  // Priority 3: Low Mastery Weakness
  if (masteryProbability < DECISION_CONFIG.MASTERY_LOW_THRESHOLD) {
    return {
      strategy: PEDAGOGICAL_STRATEGIES.CONCEPT_REMEDIATION,
      reason: "Mastery level is low and requires foundational concept rebuilding.",
      priority: DECISION_PRIORITY.HIGH,
      kc,
      masteryProbability,
      confidence,
      misconception: misconceptionContract,
    };
  }

  // Priority 4: Developing / Partial Mastery
  if (masteryProbability < DECISION_CONFIG.MASTERY_DEVELOPING_THRESHOLD) {
    return {
      strategy: PEDAGOGICAL_STRATEGIES.GUIDED_PRACTICE,
      reason: "Learner demonstrates developing mastery; guided practice recommended.",
      priority: DECISION_PRIORITY.MEDIUM,
      kc,
      masteryProbability,
      confidence,
      misconception: misconceptionContract,
    };
  }

  // Priority 5: Strong Mastery requiring Independent Practice
  if (
    masteryProbability < DECISION_CONFIG.MASTERY_STRONG_THRESHOLD ||
    confidence < DECISION_CONFIG.CONFIDENCE_MINIMUM
  ) {
    return {
      strategy: PEDAGOGICAL_STRATEGIES.INDEPENDENT_PRACTICE,
      reason: "Mastery is strong; independent practice recommended to reinforce fluency.",
      priority: DECISION_PRIORITY.LOW,
      kc,
      masteryProbability,
      confidence,
      misconception: misconceptionContract,
    };
  }

  // Priority 6: High Mastery + High Confidence -> ADVANCE or CHALLENGE
  if (hasNextTarget) {
    return {
      strategy: PEDAGOGICAL_STRATEGIES.ADVANCE,
      reason: "Mastery and confidence are high; ready to advance to next topic.",
      priority: DECISION_PRIORITY.LOW,
      kc,
      masteryProbability,
      confidence,
      misconception: misconceptionContract,
    };
  }

  return {
    strategy: PEDAGOGICAL_STRATEGIES.CHALLENGE,
    reason: "High mastery and consistent performance demonstrated; challenge extension recommended.",
    priority: DECISION_PRIORITY.LOW,
    kc,
    masteryProbability,
    confidence,
    misconception: misconceptionContract,
  };
};

module.exports = {
  evaluatePedagogicalDecision,
};
