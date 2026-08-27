/**
 * @typedef {Object} StudentContext
 * @property {string} studentId
 * @property {Object|null} learningState - Student State Agent's getFullState() result, or null if none yet.
 * @property {Object} assessment - Assessment Agent's getFullState() result (used for reassessmentPlan).
 * @property {Object} recommendation - Recommendation Agent's getByStudent() result ({ studentId, count, recommendations }).
 * @property {Object[]} recentEvents - Recent LearningEvent rows from Observation (chronological, bounded window).
 * @property {Object[]} recentAchievements - StudentAchievement rows earned within MILESTONE_LOOKBACK_HOURS.
 * @property {Object[]} pendingAssignments - Assignment rows with an upcoming dueDate and no submission.
 * @property {Object[]} pendingQuizzes - Quiz rows with an upcoming dueDate not yet completed.
 * @property {Object|null} streak - This agent's own StudentStreak row, or null if never computed.
 * @property {Object|null} learningPath - Learning Path Agent's state, if that module exists; otherwise null.
 * @property {Date} now
 */

/**
 * @typedef {Object} MotivationCandidate
 * @property {string} type - MOTIVATION_ACTION_TYPE value.
 * @property {string} dedupeKey - Stable slot identifier within (studentId, type).
 * @property {string} priority - MOTIVATION_PRIORITY value, decided directly by the detector.
 * @property {string} triggerReason - Human-readable justification.
 * @property {number} confidence - 0-100.
 * @property {Date} [recommendedAt] - When the Notification Service should ideally deliver this; defaults to now.
 * @property {Date} [expiresAt] - Explicit expiry; falls back to DEFAULT_EXPIRY_HOURS[type] if absent.
 * @property {string} [courseId]
 * @property {string} [moduleId]
 * @property {string} [lessonId]
 * @property {Object} [metadata]
 */

module.exports = {};
