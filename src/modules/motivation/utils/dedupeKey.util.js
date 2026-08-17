/**
 * Builds the stable "slot" identifier for a (studentId, type) motivation
 * action so recompute upserts the same row instead of duplicating it every
 * cycle. `target` should be whatever uniquely distinguishes this candidate
 * within its type — a concept, a courseId, an achievementId, or a fixed
 * literal for singleton types like INACTIVITY_ALERT.
 *
 * @param {string} type
 * @param {string} target
 * @returns {string}
 */
const buildDedupeKey = (type, target) => `${type}:${target}`;

module.exports = { buildDedupeKey };
