module.exports = Object.freeze({
  // --- Event-driven recompute debounce ---------------------------------
  STUDENT_RECOMPUTE_DEBOUNCE_MS: 5000, // per-student, cheap — same window as Recommendation/Motivation
  COURSE_RECOMPUTE_DEBOUNCE_MS: 60000, // per-course, triggered off TeacherInsightUpdated — longer than TI's own 30s so it settles after TI's own recompute

  // --- Scheduled sweep cadence (course/instructor/platform are too heavy for per-event recompute) ---
  COURSE_INSTRUCTOR_SWEEP_CRON: "0 * * * *", // hourly
  PLATFORM_SWEEP_CRON: "0 3 * * *", // daily 03:00

  // --- Report schedule ---------------------------------------------------
  WEEKLY_REPORT_CRON: "0 5 * * 1", // Monday 05:00
  MONTHLY_REPORT_CRON: "0 6 1 * *", // 1st of month, 06:00
  QUARTERLY_REPORT_CRON: "0 7 1 1,4,7,10 *", // 1st of Jan/Apr/Jul/Oct, 07:00
  ANNUAL_REPORT_CRON: "0 8 1 1 *", // Jan 1, 08:00

  WEEKLY_PERIOD_DAYS: 7,
  MONTHLY_PERIOD_DAYS: 30,
  QUARTERLY_PERIOD_DAYS: 90,
  ANNUAL_PERIOD_DAYS: 365,

  // --- Trend detection ----------------------------------------------------
  TREND_WINDOW_DAYS: 30, // default comparison window when a metric doesn't specify its own
  TREND_STABLE_THRESHOLD_PERCENT: 3, // |changePercent| below this -> STABLE

  // --- Forecasting ----------------------------------------------------
  FORECAST_HORIZON_DAYS: 7, // how far ahead a forecast predicts
  FORECAST_MIN_DATA_POINTS: 3, // fewer than this -> skip forecasting entirely, no fabricated confidence
  FORECAST_HISTORY_LOOKBACK_DAYS: 90, // how far back to pull AnalyticsHistory for regression input

  // --- Platform metric windows (days) -------------------------------------
  DAU_WINDOW_DAYS: 1,
  WEEKLY_ACTIVE_WINDOW_DAYS: 7, // backs ACTIVE_USERS
  MAU_WINDOW_DAYS: 30,
  AI_USAGE_WINDOW_DAYS: 30,
  RETENTION_WINDOW_DAYS: 30, // compares [t-60,t-30) cohort against [t-30,t) activity

  // --- Course metric thresholds -------------------------------------------
  COURSE_INACTIVE_DAYS: 5, // days since last LearningEvent -> counted as dropped-off for DROPOUT_RATE, same threshold Teacher Insight's INACTIVE alert uses

  // --- Report periods (kept distinct from platform metric windows for clarity) ---
  MIN_FORECAST_CONFIDENCE: 20,
  MAX_FORECAST_CONFIDENCE: 90,
});
