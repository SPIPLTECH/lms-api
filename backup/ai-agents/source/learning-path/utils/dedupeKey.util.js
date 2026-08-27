/**
 * Builds the stable "slot" identifier for a (studentId, type) learning
 * recommendation so recompute upserts the same row instead of duplicating
 * it every cycle.
 *
 * @param {string} type
 * @param {string} target
 * @returns {string}
 */
const buildDedupeKey = (type, target) => `${type}:${target}`;

/** milestoneKey keeps LearningMilestone's unique constraint non-null-safe (moduleId is optional). */
const buildMilestoneKey = (milestoneType, targetId) => `${milestoneType}:${targetId}`;

module.exports = { buildDedupeKey, buildMilestoneKey };
