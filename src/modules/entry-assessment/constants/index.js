/**
 * Standalone constants for the AI Student Entry Phase feature, extracted
 * from the (removed) assessment/student-state agents' own entryPhase.constants.js
 * copies, which were byte-identical on the shared values. No dependency on
 * any agent module's barrel constants file (the original assessment/
 * student-state barrels pulled in `../../observation` purely by accident of
 * a shared `constants/index.js` spread — this module has no such dependency).
 */
module.exports = Object.freeze({
  // Entry assessment generation (5 easy / 5 medium / 5 hard, spec's fixed shape)
  QUESTIONS_PER_DIFFICULTY: 5,
  OPTIONS_PER_QUESTION: 4,
  ENTRY_DIFFICULTIES: ["EASY", "MEDIUM", "HARD"],

  // Overall score (0-100) -> knowledge level
  KNOWLEDGE_LEVEL_BEGINNER_MAX: 40,
  KNOWLEDGE_LEVEL_INTERMEDIATE_MAX: 75,

  // Per-concept mastery (0-100) -> strong/weak split
  STRONG_CONCEPT_THRESHOLD: 70,
  WEAK_CONCEPT_THRESHOLD: 50,

  // Confidence rewards correctness on harder questions more than on easy ones.
  CONFIDENCE_DIFFICULTY_WEIGHT: { EASY: 1, MEDIUM: 1.5, HARD: 2 },

  // Below this many real human-authored questions available for the course,
  // the fallback question bank can't assemble a credible set.
  FALLBACK_MIN_TOTAL_QUESTIONS: 6,

  DEFAULT_LESSON_MINUTES: 20,

  LLM_MODEL: "claude-sonnet-4-5",
  LLM_MAX_TOKENS: 4096,
  LLM_TEMPERATURE: 0.5,

  // Course-state personalization (student-state's former entryPhase constants)
  LEARNING_MODE: {
    SMART_REVISION: "SMART_REVISION",
    STANDARD_LEARNING: "STANDARD_LEARNING",
    DEEP_LEARNING: "DEEP_LEARNING",
  },
  SMART_REVISION_THRESHOLD: 80,
  DEEP_LEARNING_THRESHOLD: 50,
  SMART_REVISION_MINUTES_MULTIPLIER: 0.2,
  SMART_REVISION_MIN_MINUTES: 5,
  SMART_REVISION_MAX_MINUTES: 15,
  DEEP_LEARNING_MINUTES_MULTIPLIER: 1.5,
});
