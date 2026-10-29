/**
 * Learning Health agent — every weight, window and threshold in one place.
 *
 * Values marked "original" come from the removed Student State agent
 * (backup/ai-agents/source/student-state/constants/), where they had already
 * been reviewed. Changing any of them changes every learner's score on the
 * next recompute — treat as a deliberate change, not a knob to poke.
 */
module.exports = Object.freeze({
  RISK_LEVELS: Object.freeze(["NEW", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),

  // Rolling window the activity signals are read over.
  WINDOW_DAYS: 14,
  HISTORY_DAYS: 30,

  // Write-path recompute: one per (student, course) per burst of activity.
  DEBOUNCE_MS: 30_000,
  // Instructor "Refresh now": at most once per course per 5 minutes.
  MANUAL_RECOMPUTE_COOLDOWN_MS: 5 * 60_000,
  // Students per write transaction (2 upserts each).
  WRITE_CHUNK_SIZE: 50,

  // Enrolled for less than this, with no activity at all -> NEW, not at risk.
  NEW_LEARNER_DAYS: 3,

  // Engagement, per 14-day window (pro-rated for learners enrolled less long).
  TARGET_ACTIVE_DAYS: 7,
  TARGET_VIDEO_MINUTES: 120,
  ENGAGEMENT_WEIGHTS: Object.freeze({ activeDays: 0.6, videoMinutes: 0.4 }),

  // Consistency: share of window days active vs. this target share, minus a
  // penalty for each day of the longest gap beyond the grace days.
  TARGET_ACTIVE_SHARE: 0.5,
  CONSISTENCY_GAP_GRACE_DAYS: 2,
  CONSISTENCY_GAP_PENALTY_PER_DAY: 4,

  // Performance. Original weights (quiz .4, pass .25, accuracy .15,
  // assignment .2) rescaled to 80%, plus BKT mastery at 20%.
  RECENT_QUIZ_WINDOW: 10,
  QUIZ_RECENCY_DECAY: 0.85,
  PERFORMANCE_WEIGHTS: Object.freeze({
    quizAverage: 0.32,
    passRate: 0.2,
    accuracy: 0.12,
    assignmentAverage: 0.16,
    mastery: 0.2,
  }),

  // Original: improvement trend over the last 6 quiz scores, 5-point delta.
  TREND_WINDOW: 6,
  TREND_MIN_ATTEMPTS: 4,
  TREND_DELTA_POINTS: 5,

  // Original inactivity ramp: 0 below 7 days, linear to 100 at 14.
  INACTIVITY_MEDIUM_RISK_DAYS: 7,
  INACTIVITY_HIGH_RISK_DAYS: 14,

  // Deadlines (new — the original agent had no due dates to use).
  DEADLINE_SOON_DAYS: 3,
  DEADLINE_SOON_BASE: 40,
  DEADLINE_SOON_MAX: 80,
  DEADLINE_EXTRA_PER_ITEM: 10,

  // Original dropout weights (inactivity .45, engagement .3, performance .25)
  // rescaled to make room for deadline risk.
  RISK_WEIGHTS: Object.freeze({
    inactivity: 0.4,
    lowEngagement: 0.25,
    lowPerformance: 0.2,
    deadline: 0.15,
  }),

  // Original 33/66 cut-offs, plus CRITICAL for the top of HIGH.
  RISK_LEVEL_THRESHOLDS: Object.freeze({ MEDIUM: 33, HIGH: 66, CRITICAL: 85 }),

  // Original completion-probability blend.
  COMPLETION_WEIGHTS: Object.freeze({ progress: 0.5, performance: 0.3, riskInverse: 0.2 }),
  COMPLETION_NEUTRAL_PERFORMANCE: 50,

  MAX_REASONS: 4,
  REASON_THRESHOLDS: Object.freeze({ lowPerformance: 50, lowEngagement: 30 }),

  // Nightly sweep (node-cron, server local time). LEARNING_HEALTH_CRON overrides.
  DEFAULT_SWEEP_CRON: "30 2 * * *",
});
