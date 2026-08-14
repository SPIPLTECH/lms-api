const { PREPARATION_SUGGESTION_TYPE, MOCK_INTERVIEW_READINESS_THRESHOLD, CODING_ASSESSMENT_GAP_COUNT_THRESHOLD } = require("../constants");

/**
 * Generates PlacementProfile.preparationSuggestions — computed and
 * embedded, not a persisted ledger, since this spec's Database Design has
 * no dedicated recommendation model for these (unlike Career Guidance's
 * CareerRecommendation). Regenerated fresh every recompute cycle rather
 * than tracked/retired like a real ledger would be.
 *
 * @param {{interviewReadinessScore:number, resumeQualityScore:number, portfolioQualityScore:number, missingSkillsCount:number, topCompanyName:string|null}} inputs
 * @returns {{type:string, reason:string}[]}
 */
const generatePreparationSuggestions = ({
  interviewReadinessScore,
  resumeQualityScore,
  portfolioQualityScore,
  missingSkillsCount,
  topCompanyName,
}) => {
  const suggestions = [];

  if (interviewReadinessScore >= MOCK_INTERVIEW_READINESS_THRESHOLD) {
    suggestions.push({
      type: PREPARATION_SUGGESTION_TYPE.MOCK_INTERVIEW,
      reason: "Your interview readiness is strong enough that a mock interview now will surface real gaps before a real one does.",
    });
  }

  if (missingSkillsCount >= CODING_ASSESSMENT_GAP_COUNT_THRESHOLD) {
    suggestions.push({
      type: PREPARATION_SUGGESTION_TYPE.CODING_ASSESSMENT,
      reason: `${missingSkillsCount} skills are missing for your top-matched opportunity — timed coding practice on these will close gaps faster than passive review.`,
    });
  }

  if (resumeQualityScore < 50) {
    suggestions.push({
      type: PREPARATION_SUGGESTION_TYPE.RESUME_IMPROVEMENT,
      reason: "Your resume signal is thin — completing your profile and adding earned credentials will strengthen it.",
    });
  }

  if (portfolioQualityScore < 50) {
    suggestions.push({
      type: PREPARATION_SUGGESTION_TYPE.PORTFOLIO_IMPROVEMENT,
      reason: "A stronger portfolio (broader demonstrated skills, more completed credentials) will improve how recruiters evaluate you.",
    });
  }

  if (topCompanyName) {
    suggestions.push({
      type: PREPARATION_SUGGESTION_TYPE.COMPANY_SPECIFIC_PREP,
      reason: `Research ${topCompanyName}'s recent work and prepare role-specific talking points — it's currently your strongest match.`,
    });
  }

  return suggestions;
};

module.exports = { generatePreparationSuggestions };
