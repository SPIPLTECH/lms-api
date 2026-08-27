/**
 * @typedef {"STUDENT"|"INSTRUCTOR"|"ADMIN"} UserRole
 * @typedef {"LEARNING"|"ASSESSMENT"|"RECOMMENDATION"|"CAREER"|"PLACEMENT"|"MOTIVATION"|"ANALYTICS"|"ADMINISTRATION"|"TECHNICAL_SUPPORT"|"NAVIGATION"|"GENERAL"} MentorIntentType
 *
 * @typedef {Object} Actor
 * @property {string} userId
 * @property {UserRole} role
 * @property {string|null} studentId - resolved StudentProfile.id, only for role=STUDENT
 * @property {string|null} instructorId - equals userId for role=INSTRUCTOR (Course.creatorId convention)
 *
 * @typedef {Object} IntentResult
 * @property {MentorIntentType} intent
 * @property {number} confidence - 0-100
 * @property {string[]} matchedKeywords
 *
 * @typedef {Object} AgentCallDescriptor
 * @property {string} agentName
 * @property {string} method
 * @property {() => Promise<any>} invoke
 *
 * @typedef {Object} AgentCallResult
 * @property {string} agentName
 * @property {string} method
 * @property {"SUCCESS"|"FAILURE"|"TIMEOUT"} status
 * @property {number} durationMs
 * @property {any} [data]
 * @property {string} [errorMessage]
 *
 * @typedef {Object} MergedContext
 * @property {Actor} actor
 * @property {Object<string, any>} byAgent - agentName -> its raw result (or null)
 * @property {Array<{source: string, type: string, title: string, urgency: number, impact: number, confidenceScore: number}>} rankedSuggestions
 * @property {Date} gatheredAt
 */

module.exports = {};
