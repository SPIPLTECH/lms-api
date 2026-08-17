/**
 * @typedef {Object} SequenceItem
 * @property {string} lessonId
 * @property {string} moduleId
 * @property {string} title
 * @property {number} order
 * @property {boolean} completed
 * @property {number} estimatedMinutes
 */

/**
 * @typedef {Object} PaceResult
 * @property {"EASE_UP"|"STANDARD"|"ACCELERATE"} difficultyAdjustment
 * @property {number} suggestedStudyMinutesPerDay
 */

/**
 * @typedef {Object} DayPlan
 * @property {Date} date
 * @property {SequenceItem[]} items
 * @property {number} totalMinutes
 */

/**
 * @typedef {Object} RecommendationCandidate
 * @property {string} type
 * @property {string} dedupeKey
 * @property {string} reason
 * @property {string} [courseId]
 * @property {string} [moduleId]
 * @property {string} [lessonId]
 * @property {Object} [metadata]
 */

/**
 * @typedef {Object} StudentContext
 * @property {string} studentId
 * @property {Date} now
 * @property {Object|null} learningState - Student State Agent's getFullState() result.
 * @property {Object[]} enrollments
 * @property {string|null} currentCourseId
 * @property {Array|null} courseStructure - modules with nested lessons/contents.
 * @property {Map<string,{completed:boolean}>} progressByLessonId
 * @property {Object|null} activeGoal
 */

module.exports = {};
