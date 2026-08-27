module.exports = Object.freeze({
  LEARNING_MODE: {
    SMART_REVISION: "SMART_REVISION",
    STANDARD_LEARNING: "STANDARD_LEARNING",
    DEEP_LEARNING: "DEEP_LEARNING",
  },

  // Same value as Assessment's/Learning Path's own copies — kept separate
  // per this codebase's per-agent convention, not a cross-module import.
  DEFAULT_LESSON_MINUTES: 20,

  // Per-concept mastery (0-100) -> learning mode. Between the two
  // thresholds is STANDARD_LEARNING (unchanged duration) — every concept
  // is always studied, only the depth/duration changes (never skipped).
  SMART_REVISION_THRESHOLD: 80, // mastery >= this -> compress into a quick revision
  DEEP_LEARNING_THRESHOLD: 50, // mastery < this -> expand into deep learning + practice

  // Smart Revision: spec's own example range is 5-15 minutes.
  SMART_REVISION_MINUTES_MULTIPLIER: 0.2,
  SMART_REVISION_MIN_MINUTES: 5,
  SMART_REVISION_MAX_MINUTES: 15,

  // Deep Learning: full lesson + extra examples/practice — 150% of the
  // original estimated duration.
  DEEP_LEARNING_MINUTES_MULTIPLIER: 1.5,
});
