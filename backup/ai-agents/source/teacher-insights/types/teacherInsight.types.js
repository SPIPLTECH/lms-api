/**
 * @typedef {Object} CourseContext
 * @property {string} courseId
 * @property {Object} course - { id, title, category, creatorId }
 * @property {string[]} studentIds - every enrolled student's StudentProfile id.
 * @property {Object[]} studentStates - Student State Agent's batch getFullState-shaped rows.
 * @property {Object} assessmentSummary - { masteryRows, openGaps } from Assessment's batch read.
 * @property {Object[]} activeRecommendations - Recommendation Agent's batch active rows.
 * @property {Object} motivationSummary - { actions, streaks } from Motivation's batch read.
 * @property {Object[]} lessons - Lesson rows with moduleId, plus a completionCount computed from Progress.
 * @property {Object[]} quizzes - Quiz rows with aggregated QuizSubmission stats (avgPercentage, passRate, submissionCount).
 * @property {Object[]} assignments - Assignment rows with submission counts.
 * @property {Object|null} learningPath - Learning Path Agent's state, if that module exists; otherwise null.
 * @property {Date} now
 */

/**
 * @typedef {Object} StudentAlertCandidate
 * @property {string} alertType - ALERT_TYPE value.
 * @property {string} studentId
 * @property {string} priority - INSIGHT_PRIORITY value.
 * @property {string} reason
 * @property {number} confidence - 0-100.
 * @property {Object} [evidence]
 */

/**
 * @typedef {Object} CourseInsightCandidate
 * @property {string} insightType - COURSE_INSIGHT_TYPE value.
 * @property {string} dedupeKey
 * @property {string} priority
 * @property {string} title
 * @property {string} reason
 * @property {number} confidence
 * @property {number} affectedStudentCount
 * @property {Object} [evidence]
 * @property {string} [moduleId]
 * @property {string} [lessonId]
 * @property {string} [quizId]
 * @property {string} [assignmentId]
 */

/**
 * @typedef {Object} TeachingRecommendationCandidate
 * @property {string} recommendationType - TEACHING_RECOMMENDATION_TYPE value.
 * @property {string} dedupeKey
 * @property {string} priority
 * @property {string} suggestedAction
 * @property {string} reason
 * @property {number} confidence
 * @property {number} affectedStudentCount
 * @property {Object} [evidence]
 */

module.exports = {};
