/**
 * Motivation agent — thresholds and wording rules in one place.
 * "Original" values come from the removed Motivation agent
 * (backup/ai-agents/source/motivation/constants/thresholds.constants.js).
 */
module.exports = Object.freeze({
  // learning-health:updated -> recompute this student, after a quiet period.
  DEBOUNCE_MS: 10_000,
  CONCURRENCY: 2,

  // How far back activity is read to measure streaks.
  STREAK_LOOKBACK_DAYS: 120,
  // Original milestones [7, 14, 30, 60, 100, 365], plus 3 so a new learner
  // gets an early, honest win.
  STREAK_MILESTONES: Object.freeze([3, 7, 14, 30, 60, 100, 365]),
  STREAK_AT_RISK_MIN_DAYS: 2,

  // Original: inactivity medium 3 days, high 7.
  COMEBACK_MEDIUM_DAYS: 3,
  COMEBACK_HIGH_DAYS: 7,

  // Original: deadline lookahead 48h, urgent 12h.
  DEADLINE_LOOKAHEAD_HOURS: 48,
  DEADLINE_URGENT_HOURS: 12,
  DEADLINE_OVERDUE_LOOKBACK_DAYS: 7,

  PROGRESS_MILESTONES: Object.freeze([25, 50, 75, 100]),
  MAX_REVISION_NUDGES: 3,

  // Shown to the student at once, highest priority first.
  MAX_ACTIVE_SHOWN: 5,
  // DISMISSED / EXPIRED rows are kept this long (so a dismissed nudge never
  // comes back), then pruned.
  PRUNE_AFTER_DAYS: 90,

  PRIORITY_ORDER: Object.freeze({ HIGH: 0, MEDIUM: 1, LOW: 2 }),

  // Hours a nudge stays up if nothing retires it sooner (original defaults).
  EXPIRY_HOURS: Object.freeze({
    STREAK_AT_RISK: 24,
    STREAK_MILESTONE: 72,
    COMEBACK: 168,
    DEADLINE: 48,
    REVISION: 168,
    PROGRESS_MILESTONE: 72,
    ENCOURAGEMENT: 72,
  }),

  // One-off celebrations: they stay until they expire, even if the condition
  // that produced them is no longer true on the next recompute.
  STICKY_TYPES: Object.freeze(["STREAK_MILESTONE", "PROGRESS_MILESTONE", "ENCOURAGEMENT"]),
});
