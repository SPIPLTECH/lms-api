module.exports = Object.freeze({
  // 5 easy / 5 medium / 5 hard, per the spec's fixed assessment shape.
  QUESTIONS_PER_DIFFICULTY: 5,
  OPTIONS_PER_QUESTION: 4,
  ENTRY_DIFFICULTIES: ["EASY", "MEDIUM", "HARD"],

  // Overall score (0-100) -> knowledge level.
  KNOWLEDGE_LEVEL_BEGINNER_MAX: 40,
  KNOWLEDGE_LEVEL_INTERMEDIATE_MAX: 75,

  // Per-concept mastery (0-100) -> strong/weak split, same numbers as
  // Assessment's own MASTERY_SCORE_THRESHOLD/WEAK_SCORE_THRESHOLD for
  // conceptual consistency across the whole agent.
  STRONG_CONCEPT_THRESHOLD: 70,
  WEAK_CONCEPT_THRESHOLD: 50,

  // Confidence rewards correctness on harder questions more than on easy
  // ones — a student who nails the HARD tier is more "confidently"
  // assessed than one who only clears EASY. Deterministic, not an LLM call.
  CONFIDENCE_DIFFICULTY_WEIGHT: { EASY: 1, MEDIUM: 1.5, HARD: 2 },

  // Below this many real human-authored questions available for the course
  // (across all difficulties), the fallback question bank can't assemble a
  // credible 15-question set — the assessment is honestly marked FAILED
  // rather than padded with fabricated questions.
  FALLBACK_MIN_TOTAL_QUESTIONS: 6,

  // Same value as Learning Path's own copy (constants/thresholds.constants.js)
  // — kept as a separate constant per this codebase's per-agent convention,
  // not a cross-module import.
  DEFAULT_LESSON_MINUTES: 20,

  LLM_MODEL: "claude-sonnet-4-5",
  LLM_MAX_TOKENS: 4096,
  LLM_TEMPERATURE: 0.5,
});
