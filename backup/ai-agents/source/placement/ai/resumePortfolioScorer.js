const {
  CREDENTIAL_SCORE_CAP,
  SKILL_COUNT_SCORE_CAP,
  RESUME_WEIGHT_CREDENTIALS,
  RESUME_WEIGHT_COMPLETENESS,
  PORTFOLIO_WEIGHT_SKILLS,
  PORTFOLIO_WEIGHT_CREDENTIALS,
} = require("../constants");
const { clamp } = require("../utils/scoreMath.util");

/**
 * No Resume/Portfolio model exists anywhere in this LMS — there is no
 * actual resume or portfolio content to run analysis against. These are
 * honest proxies computed from real signals (real Certificate rows, real
 * SkillAssessment breadth, real StudentProfile completeness), not a claim
 * about actual document content quality — see PROFILE_COMPLETENESS_FIELDS.
 *
 * @param {{credentialCount: number, skillCount: number, profileCompletenessRatio: number}} inputs
 * @returns {import("../types/placement.types").ResumePortfolioResult}
 */
const calculateResumePortfolioScores = ({ credentialCount, skillCount, profileCompletenessRatio }) => {
  const credentialScore = clamp((Math.min(credentialCount, CREDENTIAL_SCORE_CAP) / CREDENTIAL_SCORE_CAP) * 100);
  const skillScore = clamp((Math.min(skillCount, SKILL_COUNT_SCORE_CAP) / SKILL_COUNT_SCORE_CAP) * 100);
  const completenessScore = clamp(profileCompletenessRatio * 100);

  const resumeQualityScore = Math.round(clamp(credentialScore * RESUME_WEIGHT_CREDENTIALS + completenessScore * RESUME_WEIGHT_COMPLETENESS));
  const portfolioQualityScore = Math.round(clamp(skillScore * PORTFOLIO_WEIGHT_SKILLS + credentialScore * PORTFOLIO_WEIGHT_CREDENTIALS));

  return { resumeQualityScore, portfolioQualityScore };
};

module.exports = { calculateResumePortfolioScores };
