/**
 * Learning Path agent (study plan) — every estimate and threshold in one
 * place. "Original" values come from the removed Learning Path agent
 * (backup/ai-agents/source/learning-path/constants/thresholds.constants.js).
 */
module.exports = Object.freeze({
  DEBOUNCE_MS: 10_000,
  CONCURRENCY: 2,
  // A stored plan older than this is recomputed when the student opens it.
  STALE_AFTER_MS: 24 * 3_600_000,

  // Original: 30 min/day when the learner's own budget is unknown; never
  // plan below 10 min/day.
  DEFAULT_DAILY_MINUTES: 30,
  MIN_DAILY_MINUTES: 10,
  WEEKLY_PLAN_DAYS: 7,

  // Original pace adjustment: ease up below a 50 pass rate, accelerate at 80+
  // with an improving trend. Applied to the daily budget.
  EASE_UP_PERFORMANCE_BELOW: 50,
  ACCELERATE_PERFORMANCE_AT: 80,
  EASE_UP_MULTIPLIER: 0.8,
  ACCELERATE_MULTIPLIER: 1.3,

  // Step estimates (minutes). Content.duration is in seconds.
  VIDEO_DEFAULT_MINUTES: 10,
  QUIZ_MINUTES_PER_QUESTION: 1.5,
  QUIZ_DEFAULT_MINUTES: 15,
  ASSIGNMENT_MINUTES: 30,
  READING_MINUTES: 8,
  OTHER_MINUTES: 5,
  MIN_STEP_MINUTES: 2,
  MAX_STEP_MINUTES: 120,
  READING_TYPES: Object.freeze(["TEXT", "HTML", "DOCUMENT", "PDF", "PRESENTATION", "FILE", "CODE"]),

  // Revision slots from learner-model's fading concepts, at the start of day 1.
  MAX_REVISION_ITEMS: 2,
  REVISION_MINUTES: 10,
});
