module.exports = Object.freeze({
  // --- Event-driven recompute debounce ---------------------------------
  STUDENT_RECOMPUTE_DEBOUNCE_MS: 5000, // per-student, same window as every other student-scoped agent in this series

  // --- Scheduled sweep ----------------------------------------------------
  DAILY_SWEEP_CRON: "0 4 * * *", // safety net for students who haven't triggered a real-time student-state:updated recently

  // --- Effort estimation ----------------------------------------------
  DEFAULT_LESSON_MINUTES: 20, // fallback when a lesson's Content rows carry no duration data
  DEFAULT_DAILY_STUDY_MINUTES: 30, // fallback when neither dailyStudyTimeSeconds nor preferredStudyDurationSeconds is known yet
  MIN_DAILY_STUDY_MINUTES: 10, // floor for completion-date math — never divide by an unrealistically tiny daily budget

  // --- Pace adjustment ----------------------------------------------------
  EASE_UP_PASS_RATE_THRESHOLD: 50, // quiz pass rate below this -> ease up regardless of speed
  ACCELERATE_PASS_RATE_THRESHOLD: 80, // pass rate at/above this, FAST speed, IMPROVING trend -> accelerate
  EASE_UP_MINUTES_MULTIPLIER: 0.8,
  ACCELERATE_MINUTES_MULTIPLIER: 1.3,

  // --- Study plan ----------------------------------------------------
  WEEKLY_PLAN_DAYS: 7,
});
