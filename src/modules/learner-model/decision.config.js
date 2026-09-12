/**
 * Adaptive Pedagogical Decision Engine Configuration.
 *
 * Defines strategy vocabulary, decision priorities, and threshold boundaries.
 */

const PEDAGOGICAL_STRATEGIES = {
  CONCEPT_REMEDIATION: "CONCEPT_REMEDIATION",
  MISCONCEPTION_REMEDIATION: "MISCONCEPTION_REMEDIATION",
  GUIDED_PRACTICE: "GUIDED_PRACTICE",
  INDEPENDENT_PRACTICE: "INDEPENDENT_PRACTICE",
  CHALLENGE: "CHALLENGE",
  REVIEW: "REVIEW",
  ADVANCE: "ADVANCE",
};

const DECISION_PRIORITY = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
};

const DECISION_CONFIG = {
  // Mastery thresholds
  MASTERY_LOW_THRESHOLD: 0.40,        // Below 0.40 -> Low mastery
  MASTERY_DEVELOPING_THRESHOLD: 0.70, // 0.40 - 0.69 -> Developing
  MASTERY_STRONG_THRESHOLD: 0.85,     // 0.85+ -> High / Strong

  // Misconception threshold
  MISCONCEPTION_ACTIVE_THRESHOLD: 0.35, // Open gap with severity >= 0.35 overrides

  // Confidence threshold
  CONFIDENCE_MINIMUM: 0.50,

  // Degradation threshold (prior mastery vs current mastery drop)
  DEGRADATION_DROP_THRESHOLD: 0.25,
};

module.exports = {
  PEDAGOGICAL_STRATEGIES,
  DECISION_PRIORITY,
  DECISION_CONFIG,
};
