/**
 * @typedef {Object} IncomingEventDTO
 * @property {string} eventType - One of EVENT_TYPES (constants/eventTypes.constants.js)
 * @property {string} [studentId] - StudentProfile.id; defaults to the caller's own profile
 * @property {string} [courseId]
 * @property {string} [moduleId]
 * @property {string} [lessonId]
 * @property {string} [contentId]
 * @property {string} [quizId]
 * @property {string} [assignmentId]
 * @property {string} [sessionId] - Groups events into a browsing/activity session
 * @property {Object} [payload] - Event-shape-specific data (e.g. { positionSeconds, durationSeconds })
 * @property {Object} [metadata] - Free-form, non-indexed context (device, locale, feature flags)
 * @property {string} [source] - Emitting module/service, e.g. "video-player", "quiz.service"
 * @property {string|Date} [clientTimestamp] - When the client observed the event, if different from ingest time
 */

/**
 * @typedef {Object} EventActor
 * @property {string} id - User.id of the caller
 * @property {string} role - Role: ADMIN | INSTRUCTOR | STUDENT | GUEST
 * @property {string} [studentId] - StudentProfile.id, resolved for STUDENT role
 */

/**
 * @typedef {Object} RequestContext
 * @property {string} [ipAddress]
 * @property {string} [userAgent]
 */

/**
 * @typedef {Object} EventQueryFilters
 * @property {string} [eventType]
 * @property {string} [eventCategory]
 * @property {string} [courseId]
 * @property {string|Date} [startDate]
 * @property {string|Date} [endDate]
 * @property {number} [page]
 * @property {number} [limit]
 */

module.exports = {};
