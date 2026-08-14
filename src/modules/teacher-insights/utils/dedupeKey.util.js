/**
 * Builds the stable "slot" identifier for a (courseId, type) insight so
 * recompute upserts the same row instead of duplicating it every cycle.
 * `target` is whatever uniquely distinguishes this candidate within its
 * type — a concept name, lessonId, quizId, or assignmentId.
 *
 * @param {string} type
 * @param {string} target
 * @returns {string}
 */
const buildDedupeKey = (type, target) => `${type}:${target}`;

module.exports = { buildDedupeKey };
