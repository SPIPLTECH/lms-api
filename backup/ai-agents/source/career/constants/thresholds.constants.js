const { ROADMAP_HORIZON, CAREER_RECOMMENDATION_TYPE } = require("./enums.constants");

module.exports = Object.freeze({
  // --- Event-driven recompute debounce ---------------------------------
  STUDENT_RECOMPUTE_DEBOUNCE_MS: 5000, // per-student, same window as Recommendation/Motivation/Analytics-student-scope

  // --- Scheduled sweep cadence -------------------------------------------
  DAILY_SAFETY_SWEEP_CRON: "0 4 * * *", // catches "course completed"/"certificate earned"/"project completed" triggers that have no real-time hook anywhere in this codebase
  TAXONOMY_REFRESH_CRON: "0 5 1 * *", // monthly — refreshes IndustryRole.industryDemandScore/avgSalary via ai/jobMarketProvider.js

  // --- Recommendation scoring (mirrors Recommendation Agent's scoringEngine.js) ---
  URGENCY_WEIGHT: 0.55,
  IMPACT_WEIGHT: 0.45,
  PRIORITY_HIGH_THRESHOLD: 70,
  PRIORITY_MEDIUM_THRESHOLD: 40,
  MAX_ACTIVE_RECOMMENDATIONS: 20,

  // --- Skill matching / gap analysis ---------------------------------------
  TOP_MATCHED_ROLES_COUNT: 5,
  TOP_MISSING_SKILLS_COUNT: 8,
  SKILL_GAP_SEVERITY_THRESHOLDS: { CRITICAL: 60, HIGH: 40, MEDIUM: 20 }, // gapSize >= threshold; below MEDIUM -> LOW

  // --- Readiness scoring (weights sum to 1) -------------------------------
  READINESS_WEIGHT_SKILL_MATCH: 0.35,
  READINESS_WEIGHT_ASSESSMENT_MASTERY: 0.25,
  READINESS_WEIGHT_STUDENT_STATE: 0.2,
  READINESS_WEIGHT_CREDENTIALS: 0.1,
  READINESS_WEIGHT_ACTIVITY: 0.1,
  READINESS_READY_THRESHOLD: 75,
  READINESS_APPROACHING_THRESHOLD: 50,
  CREDENTIAL_SCORE_CAP: 5, // certificates beyond this count don't add further readiness credit
  MIN_SKILL_SIGNALS_FOR_HIGH_CONFIDENCE: 6, // # of SkillAssessment rows
  MIN_SKILL_SIGNALS_FOR_MEDIUM_CONFIDENCE: 2,

  // --- Roadmap generation ---------------------------------------------
  ROADMAP_HORIZON_DAYS: {
    [ROADMAP_HORIZON.DAYS_30]: 30,
    [ROADMAP_HORIZON.DAYS_90]: 90,
    [ROADMAP_HORIZON.MONTHS_6]: 180,
    [ROADMAP_HORIZON.YEAR_1]: 365,
  },
  // Rough estimated-effort-in-days per recommendation type, used to bucket
  // ranked candidates into the earliest horizon they realistically fit.
  ESTIMATED_EFFORT_DAYS: {
    [CAREER_RECOMMENDATION_TYPE.RESUME_IMPROVEMENT]: 7,
    [CAREER_RECOMMENDATION_TYPE.MOCK_INTERVIEW]: 7,
    [CAREER_RECOMMENDATION_TYPE.COURSE]: 20,
    [CAREER_RECOMMENDATION_TYPE.TECHNICAL_INTERVIEW_TOPIC]: 14,
    [CAREER_RECOMMENDATION_TYPE.APTITUDE_PREP]: 14,
    [CAREER_RECOMMENDATION_TYPE.PORTFOLIO_IMPROVEMENT]: 14,
    [CAREER_RECOMMENDATION_TYPE.HACKATHON]: 14,
    [CAREER_RECOMMENDATION_TYPE.PROJECT]: 30,
    [CAREER_RECOMMENDATION_TYPE.INTERNSHIP_PREP]: 30,
    [CAREER_RECOMMENDATION_TYPE.OPEN_SOURCE_CONTRIBUTION]: 30,
    [CAREER_RECOMMENDATION_TYPE.CERTIFICATION]: 45,
  },

  // --- Ranking ----------------------------------------------------------
  PRIORITY_RANK: { HIGH: 3, MEDIUM: 2, LOW: 1 },
});
