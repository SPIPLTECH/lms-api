/**
 * Career Guidance agent — weights and thresholds. "Original" values come from
 * the removed Career agent (backup/ai-agents/source/career/constants/).
 */
module.exports = Object.freeze({
  // Original readiness weights.
  READINESS_WEIGHTS: Object.freeze({
    skillMatch: 0.35,
    mastery: 0.25,
    learningHealth: 0.2,
    credentials: 0.1,
    activity: 0.1,
  }),
  // Original: READY at 75, APPROACHING at 50.
  READY_AT: 75,
  APPROACHING_AT: 50,
  // Original: certificate count scored against a cap of 5.
  CREDENTIAL_CAP: 5,

  // Original gap severity: gapSize (weight x missing proficiency, 0-100) >= threshold.
  GAP_SEVERITY: Object.freeze({ CRITICAL: 60, HIGH: 40, MEDIUM: 20 }),
  // Original confidence: number of skills with any evidence.
  CONFIDENCE_HIGH_AT: 6,
  CONFIDENCE_MEDIUM_AT: 2,

  // Proficiency (0-1) credited per evidence source. BKT mastery is used as-is.
  COMPLETED_COURSE_PROFICIENCY: 0.7,
  SELF_REPORTED_PROFICIENCY: 0.5,

  MAX_GAPS: 3,
  COURSES_PER_GAP: 3,
  TOP_MATCHES: 3,
});
