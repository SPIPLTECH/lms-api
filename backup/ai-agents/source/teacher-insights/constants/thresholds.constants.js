module.exports = Object.freeze({
  // Per-course debounce window for event-triggered recompute — longer than
  // the 5s used by per-student agents, since a class-wide recompute across
  // every enrolled student is a heavier operation than a single student's.
  RECOMPUTE_DEBOUNCE_MS: 30000,

  // --- StudentAlert thresholds ---------------------------------------
  AT_RISK_DROPOUT_SCORE: 50, // Student State risk.dropoutRiskScore at/above this
  STRUGGLING_OPEN_GAP_COUNT: 2, // open KnowledgeGaps at/above this
  STRUGGLING_AVG_SEVERITY: 40, // average severity of open gaps at/above this
  INACTIVE_DAYS: 5, // days since engagement.lastActiveAt
  TOP_PERFORMER_SCORE: 80, // Student State performanceScore + engagementScore both at/above this
  TOP_PERFORMER_MAX_RISK: 20, // and dropoutRiskScore at/below this

  // --- CourseInsight thresholds ---------------------------------------
  WEAK_CONCEPT_AVG_MASTERY: 50, // class-average masteryScore at/below this
  WEAK_CONCEPT_MIN_STUDENTS: 2, // minimum students who've attempted the concept, to avoid one-student noise
  STRONG_CONCEPT_AVG_MASTERY: 85,

  LOW_COMPLETION_RATE: 60, // % of enrolled students who completed a lesson, at/below this -> flagged
  DIFFICULT_QUIZ_PASS_RATE: 60, // % pass rate at/below this -> flagged difficult
  DIFFICULT_QUIZ_MIN_SUBMISSIONS: 3, // minimum submissions before judging a quiz's difficulty
  LOW_ASSIGNMENT_SUBMISSION_RATE: 60, // % of enrolled students who submitted, at/below this -> flagged
  // Assignment grades are free-text in this LMS (see AssignmentSubmission.grade,
  // same limitation Student State's performance reducer documents) — so
  // assignment difficulty is judged by submission/on-time rate, not score.

  // --- CourseHealth composite weights (sum to 1) -----------------------
  HEALTH_WEIGHT_ENGAGEMENT: 0.3,
  HEALTH_WEIGHT_PERFORMANCE: 0.3,
  HEALTH_WEIGHT_COMPLETION: 0.2,
  HEALTH_WEIGHT_RISK: 0.2, // inverted: (100 - atRiskPercent) contributes

  // --- Ranking ----------------------------------------------------------
  PRIORITY_RANK: { HIGH: 3, MEDIUM: 2, LOW: 1 },

  // --- Report periods -----------------------------------------------
  WEEKLY_SUMMARY_DAYS: 7,
  MONTHLY_SUMMARY_DAYS: 30,
});
