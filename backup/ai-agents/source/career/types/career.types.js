/**
 * @typedef {Object} SkillVectorEntry
 * @property {string} skillName
 * @property {number} proficiency - 0-100
 * @property {string} status
 */

/**
 * @typedef {Object} RoleMatch
 * @property {string} roleId
 * @property {string} roleName
 * @property {number} matchPercent - 0-100
 */

/**
 * @typedef {Object} SkillGapCandidate
 * @property {string} skillName
 * @property {number} requiredLevel
 * @property {number} currentLevel
 * @property {number} gapSize
 * @property {"LOW"|"MEDIUM"|"HIGH"|"CRITICAL"} severity
 */

/**
 * @typedef {Object} ReadinessResult
 * @property {number} readinessScore - 0-100
 * @property {"LOW"|"MEDIUM"|"HIGH"} confidenceLevel
 * @property {"NOT_READY"|"APPROACHING"|"READY"} industryReadiness
 */

/**
 * @typedef {Object} CareerCandidate
 * @property {string} type
 * @property {string} dedupeKey
 * @property {string} reason
 * @property {number} urgency - 0-100
 * @property {number} impact - 0-100
 * @property {number} confidence - 0-100
 * @property {number} [estimatedTimeMinutes]
 * @property {Object} [metadata]
 */

/**
 * @typedef {Object} StudentContext
 * @property {string} studentId
 * @property {Date} now
 * @property {Object|null} learningState - Student State Agent's getFullState() result.
 * @property {Object|null} assessmentState - Assessment Agent's getFullState() result.
 * @property {Object|null} analyticsSnapshot - Analytics Agent's getByStudent() result.
 * @property {Object[]} certificates
 * @property {Object|null} activeGoal
 */

module.exports = {};
