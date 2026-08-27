module.exports = Object.freeze({
  // Normalization caps for engagement scoring (values above the cap clamp to 100%).
  ENGAGEMENT_STUDY_TIME_CAP_MINUTES_PER_DAY: 60,
  ENGAGEMENT_SESSION_CAP_PER_WEEK: 10,
  CONSISTENCY_STREAK_CAP_DAYS: 30,

  // Risk.
  INACTIVITY_MEDIUM_RISK_DAYS: 7,
  INACTIVITY_HIGH_RISK_DAYS: 14,
  LOW_ENGAGEMENT_SESSION_FLOOR_PER_WEEK: 2,
  DEADLINE_RISK_GRACE_DAYS: 3, // days an assignment can sit "started" before deadline risk starts climbing
  DEADLINE_RISK_MAX_DAYS: 10, // days at which deadline risk saturates at 100

  DROPOUT_RISK_HIGH: 66,
  DROPOUT_RISK_MEDIUM: 33,

  // Performance / behavior.
  MIN_ATTEMPTS_FOR_TOPIC_RANKING: 2,
  MAX_TOPICS_TRACKED: 8,
  RECENT_QUIZ_SCORES_WINDOW: 6,
  IMPROVEMENT_TREND_DELTA_POINTS: 5, // percentage-point delta to call it IMPROVING/DECLINING vs STABLE

  SPEED_SLOW_MAX: 0.9,
  SPEED_FAST_MIN: 1.25,
});
