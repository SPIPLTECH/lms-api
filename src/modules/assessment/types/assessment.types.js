/**
 * @typedef {Object} ConceptEvidence
 *   One concept-level score extracted from an evaluative LearningEvent.
 * @property {string} concept
 * @property {number} scorePercent - 0-100
 * @property {string|null} courseId
 * @property {string|null} sourceEventId
 * @property {"QUIZ"|"ASSIGNMENT"|"CODING"} evidenceType
 * @property {Date} observedAt
 */

/**
 * @typedef {Object} ConceptMasteryState
 * @property {string} concept
 * @property {number} masteryScore - 0-100, EMA of evidence
 * @property {number} confidenceLevel - 0-100
 * @property {"UNASSESSED"|"WEAK"|"DEVELOPING"|"MASTERED"} status
 * @property {number} attemptsCount
 * @property {number[]} recentScores
 * @property {"IMPROVING"|"DECLINING"|"STABLE"} trend
 * @property {string|null} lastCourseId
 * @property {Date|null} lastAssessedAt
 * @property {Date|null} nextReassessmentAt
 */

/**
 * @typedef {Object} KnowledgeGapState
 * @property {string} concept
 * @property {number} severity
 * @property {"OPEN"|"CLOSED"} status
 * @property {Date} detectedAt
 * @property {Date|null} closedAt
 */

/**
 * @typedef {Object} AssessmentRecommendation
 * @property {"ADAPTIVE"|"REVISION"} type
 * @property {string[]} targetConcepts
 * @property {"EASY"|"MEDIUM"|"HARD"} difficulty
 * @property {string} rationale
 * @property {string|null} courseId
 */

module.exports = {};
