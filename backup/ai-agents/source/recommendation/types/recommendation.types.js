/**
 * @typedef {Object} StudentContext
 * @property {string} studentId
 * @property {Object|null} learningState - Student State Agent's getFullState() result, or null if none yet.
 * @property {Object} assessment - Assessment Agent's getFullState() result ({ mastery, knowledgeGaps, recommendations, reassessmentPlan }).
 * @property {Object[]} recentEvents - Recent LearningEvent rows from Observation (chronological, bounded window).
 * @property {Object[]} enrollments - Enrollment rows with course/module/lesson catalog joined in.
 * @property {Object[]} pendingAssignments - Assignment rows with an upcoming/passed dueDate and no passing submission.
 * @property {Object[]} pendingQuizzes - Quiz rows with an upcoming/passed dueDate not yet completed.
 * @property {string} learningGoals - Free-text StudentProfile.learningGoals (may be empty string).
 * @property {Object|null} learningPath - Learning Path Agent's state, if that module exists; otherwise null.
 * @property {Date} now
 */

/**
 * @typedef {Object} Candidate
 * @property {string} type - RECOMMENDATION_TYPE value.
 * @property {string} dedupeKey - Stable slot identifier within (studentId, type), e.g. "algebra" or a courseId.
 * @property {string} reason - Human-readable justification.
 * @property {number} urgency - 0-100.
 * @property {number} impact - 0-100.
 * @property {number} confidence - 0-100.
 * @property {number} [estimatedTimeMinutes]
 * @property {string} [courseId]
 * @property {string} [moduleId]
 * @property {string} [lessonId]
 * @property {Object} [metadata]
 * @property {Date} [expiresAt] - Explicit expiry (e.g. a real deadline); falls back to DEFAULT_EXPIRY_HOURS[type] if absent.
 */

/**
 * @typedef {Object} ScoredCandidate
 * @augments Candidate
 * @property {number} score - 0-100.
 * @property {string} priority - RECOMMENDATION_PRIORITY value.
 */

module.exports = {};
