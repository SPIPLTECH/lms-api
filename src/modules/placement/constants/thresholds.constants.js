module.exports = Object.freeze({
  // --- Event-driven recompute debounce ---------------------------------
  STUDENT_RECOMPUTE_DEBOUNCE_MS: 5000, // per-student, same window as every other student-scoped agent in this series

  // --- Scheduled sweeps -------------------------------------------------
  DAILY_SWEEP_CRON: "0 4 * * *", // safety net for "resume/portfolio updated"/"certification completed" — no real-time hook exists for either
  CATALOG_REFRESH_CRON: "0 6 * * *", // refreshes the job/internship/company catalog via integrations/jobPortalProvider.js

  // --- Matching -------------------------------------------------------
  TOP_MATCHES_COUNT: 15, // active JobMatch rows kept per student, across both JOB and INTERNSHIP
  TOP_MISSING_SKILLS_COUNT: 8,
  MATCH_PRIORITY_HIGH_THRESHOLD: 75, // matchPercent >= this -> HIGH priority
  MATCH_PRIORITY_MEDIUM_THRESHOLD: 45,

  // --- Opportunity ranking ----------------------------------------------
  RANKING_MATCH_WEIGHT: 0.7,
  RANKING_URGENCY_WEIGHT: 0.3,
  DEADLINE_URGENCY_WINDOW_DAYS: 14, // deadlines inside this window score maximum urgency; further out decays toward 0

  // --- Resume/portfolio proxy scoring (no real resume/portfolio content exists to analyze) ---
  CREDENTIAL_SCORE_CAP: 5, // certificates beyond this count don't add further credit
  SKILL_COUNT_SCORE_CAP: 10, // SkillAssessment rows beyond this count don't add further credit
  PROFILE_COMPLETENESS_FIELDS: ["education", "phone", "dateOfBirth", "focusTopics", "interests", "learningGoals"],
  RESUME_WEIGHT_CREDENTIALS: 0.5,
  RESUME_WEIGHT_COMPLETENESS: 0.5,
  PORTFOLIO_WEIGHT_SKILLS: 0.6,
  PORTFOLIO_WEIGHT_CREDENTIALS: 0.4,

  // --- Interview readiness ----------------------------------------------
  INTERVIEW_WEIGHT_CAREER_READINESS: 0.4,
  INTERVIEW_WEIGHT_ASSESSMENT_MASTERY: 0.3,
  INTERVIEW_WEIGHT_HISTORY: 0.3,
  INTERVIEW_PASS_RATE_DEFAULT: 50, // used when there's no interview history yet — a neutral midpoint, not a fabricated confident number
  MIN_INTERVIEWS_FOR_HISTORY_WEIGHT: 2, // fewer than this -> history contributes nothing, weight redistributed to the other two signals

  // --- Placement readiness (composite, weights sum to 1) -------------------
  READINESS_WEIGHT_JOB_MATCH: 0.3,
  READINESS_WEIGHT_INTERVIEW: 0.25,
  READINESS_WEIGHT_RESUME: 0.15,
  READINESS_WEIGHT_PORTFOLIO: 0.15,
  READINESS_WEIGHT_CAREER: 0.15,

  // --- Preparation suggestion gating ----------------------------------
  MOCK_INTERVIEW_READINESS_THRESHOLD: 50, // interview readiness at/above this -> suggest a mock interview is worthwhile
  CODING_ASSESSMENT_GAP_COUNT_THRESHOLD: 3, // missing skills at/above this -> suggest coding practice
});
