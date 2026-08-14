module.exports = Object.freeze({
  // --- Event-driven recompute debounce -------------------------------------
  // Heavy institution-wide aggregation, not per-student — same policy
  // Analytics uses for its own PLATFORM scope, not the cheap 5s student one.
  RECOMPUTE_DEBOUNCE_MS: 60000,

  // --- Scheduled sweep cadence (no honest event exists for Enrollment
  // Changes / Semester Starts-Ends / Revenue Changes / Infrastructure
  // Changes anywhere in this codebase — this is their only trigger) -------
  DAILY_SWEEP_CRON: "0 4 * * *", // daily 04:00, after Analytics' own 03:00 platform sweep so this agent reads fresh KPIs

  // --- Report schedule ------------------------------------------------------
  WEEKLY_REPORT_CRON: "30 5 * * 1", // Monday 05:30
  MONTHLY_REPORT_CRON: "30 6 1 * *",
  QUARTERLY_REPORT_CRON: "30 7 1 1,4,7,10 *",
  ANNUAL_REPORT_CRON: "30 8 1 1 *",
  SEMESTER_REPORT_CRON: "30 8 1 1,7 *", // no real Semester model exists — Jan 1 / Jul 1 is this agent's own configurable approximation of a semester boundary

  WEEKLY_PERIOD_DAYS: 7,
  MONTHLY_PERIOD_DAYS: 30,
  QUARTERLY_PERIOD_DAYS: 90,
  ANNUAL_PERIOD_DAYS: 365,
  SEMESTER_PERIOD_DAYS: 182,

  // --- Forecasting ------------------------------------------------------
  FORECAST_HORIZON_DAYS: 14, // "next semester" resource planning looks further out than Analytics' own 7-day metric forecast
  FORECAST_MIN_DATA_POINTS: 3, // fewer than this -> skip regression entirely, no fabricated confidence
  FORECAST_HISTORY_LOOKBACK_DAYS: 90,
  MIN_FORECAST_CONFIDENCE: 20,
  MAX_FORECAST_CONFIDENCE: 90,
  // Derived (not regressed) forecasts are explicitly less rigorous than a
  // real OLS fit — capped lower so they never masquerade as equally certain.
  MAX_DERIVED_FORECAST_CONFIDENCE: 40,

  // --- Institution health composite weights (sum to 1) ---------------------
  HEALTH_WEIGHT_ACADEMIC: 0.35,
  HEALTH_WEIGHT_FACULTY: 0.25,
  HEALTH_WEIGHT_AI_ADOPTION: 0.15,
  HEALTH_WEIGHT_RETENTION: 0.15,
  HEALTH_WEIGHT_CHURN: 0.1,

  // --- Faculty analytics thresholds -----------------------------------------
  FACULTY_OVERLOAD_COURSE_COUNT: 5, // courses taught concurrently -> INSTRUCTOR_OVERLOAD

  // --- Department/course governance thresholds ------------------------------
  DEPARTMENT_HEALTH_RECOMMEND_THRESHOLD: 60, // below this -> COURSE_IMPROVEMENT / CURRICULUM_UPDATE candidate
  DEPARTMENT_HEALTH_ALERT_THRESHOLD: 40, // below this -> DEPARTMENT_DECLINE alert (stricter than the recommendation threshold)
  DEPARTMENT_DECLINE_TREND_PERCENT: -15, // enrollment trend below this -> CURRICULUM_UPDATE candidate
  STALE_DRAFT_DAYS: 30, // days a course can sit in DRAFT before COURSE_PUBLISHING_HYGIENE flags it

  // --- Risk ------------------------------------------------------------------
  RISK_SURGE_COUNT_THRESHOLD: 10, // institution-wide HIGH-risk student count -> RISK_INTERVENTION + HIGH_RISK_SURGE alert

  // --- AI decision audit -------------------------------------------------
  LOW_CONFIDENCE_THRESHOLD: 40, // a teaching recommendation below this confidence is "low quality"
  MAX_LOW_CONFIDENCE_RATIO: 25, // % of low-confidence recommendations tolerated before AI_DECISION_QUALITY fails

  // --- Capacity ------------------------------------------------------------
  CAPACITY_WARNING_ENROLLMENT_PER_INSTRUCTOR: 80, // predicted students-per-instructor above this -> CAPACITY_WARNING

  // --- Strategic recommendation list cap ------------------------------------
  STRATEGIC_RECOMMENDATION_CAP: 20,
  ADMIN_INSIGHT_DEPARTMENT_CALLOUT_COUNT: 3, // top/bottom department callouts included alongside the 6 fixed platform insights
});
