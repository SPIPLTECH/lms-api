/**
 * Builds the stable "slot" identifier for a (studentId, type) career
 * recommendation so recompute upserts the same row instead of duplicating
 * it every cycle. `target` should be whatever uniquely distinguishes this
 * candidate within its type — a skill name, a role id, or a fixed literal
 * for singleton types.
 *
 * @param {string} type
 * @param {string} target
 * @returns {string}
 */
const buildDedupeKey = (type, target) => `${type}:${target}`;

/** Normalizes a skill/concept name for matching across sources with no shared taxonomy ID (trim + lowercase). */
const normalizeSkillName = (name) => (name || "").trim().toLowerCase();

module.exports = { buildDedupeKey, normalizeSkillName };
