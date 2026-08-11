/**
 * Builds the stable "slot" identifier for a (studentId, opportunityType,
 * opportunityId) job match so recompute upserts the same row instead of
 * duplicating it every cycle.
 *
 * @param {string} opportunityType
 * @param {string} opportunityId
 * @returns {string}
 */
const buildDedupeKey = (opportunityType, opportunityId) => `${opportunityType}:${opportunityId}`;

/** Normalizes a skill name for matching across sources with no shared taxonomy ID (trim + lowercase) — same convention as Career Guidance's utils/dedupeKey.util.js. */
const normalizeSkillName = (name) => (name || "").trim().toLowerCase();

module.exports = { buildDedupeKey, normalizeSkillName };
