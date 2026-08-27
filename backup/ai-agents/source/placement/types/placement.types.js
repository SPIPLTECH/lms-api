/**
 * @typedef {Object} SkillVectorEntry
 * @property {string} skillName
 * @property {number} proficiency - 0-100
 */

/**
 * @typedef {Object} OpportunityMatch
 * @property {string} opportunityType - "JOB"|"INTERNSHIP"
 * @property {string} opportunityId
 * @property {number} matchPercent - 0-100
 * @property {string[]} missingSkills
 */

/**
 * @typedef {Object} InterviewReadinessResult
 * @property {number} interviewReadinessScore - 0-100
 */

/**
 * @typedef {Object} ResumePortfolioResult
 * @property {number} resumeQualityScore - 0-100
 * @property {number} portfolioQualityScore - 0-100
 */

/**
 * @typedef {Object} PlacementReadinessResult
 * @property {number} placementReadinessScore - 0-100
 */

/**
 * @typedef {Object} StudentContext
 * @property {string} studentId
 * @property {Date} now
 * @property {Object|null} careerState - Career Guidance Agent's getFullState() result.
 * @property {Object|null} learningState - Student State Agent's getFullState() result.
 * @property {Object|null} assessmentState - Assessment Agent's getFullState() result.
 * @property {Object[]} activeRecommendations - Recommendation Agent's active recommendations.
 * @property {Object[]} certificates
 * @property {Object|null} studentProfile
 * @property {Array} jobCatalog
 * @property {Array} internshipCatalog
 * @property {Object[]} interviewHistory
 * @property {Object|null} previousProfile
 */

module.exports = {};
