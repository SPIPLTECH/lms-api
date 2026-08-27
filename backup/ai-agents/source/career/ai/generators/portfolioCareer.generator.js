const { CAREER_RECOMMENDATION_TYPE } = require("../../constants");
const { buildDedupeKey } = require("../../utils/dedupeKey.util");
const { clamp } = require("../../utils/scoreMath.util");

/**
 * Portfolio/resume are always relevant (living documents); hackathons and
 * open-source contributions only surface once fundamentals are solid
 * enough (readinessScore >= 50) that they're realistic next steps rather
 * than premature asks.
 *
 * @param {import("../../types/career.types").StudentContext & {credentials: Array, previousReadinessScore: number}} context
 * @returns {import("../../types/career.types").CareerCandidate[]}
 */
const generate = (context) => {
  const credentialCount = context.credentials?.length || 0;
  const readinessScore = context.previousReadinessScore ?? 50;
  const candidates = [];

  candidates.push({
    type: CAREER_RECOMMENDATION_TYPE.PORTFOLIO_IMPROVEMENT,
    dedupeKey: buildDedupeKey(CAREER_RECOMMENDATION_TYPE.PORTFOLIO_IMPROVEMENT, "general"),
    reason:
      credentialCount === 0
        ? "No completed-course credentials yet — a portfolio showcasing your strongest coursework gives recruiters something concrete to evaluate."
        : "Keep your portfolio current with your most recent, strongest work.",
    urgency: credentialCount === 0 ? 60 : 30,
    impact: 55,
    confidence: 60,
    estimatedTimeMinutes: 180,
    metadata: { credentialCount },
  });

  candidates.push({
    type: CAREER_RECOMMENDATION_TYPE.RESUME_IMPROVEMENT,
    dedupeKey: buildDedupeKey(CAREER_RECOMMENDATION_TYPE.RESUME_IMPROVEMENT, "general"),
    reason: "Align your resume's skills section with your target role's required skills so it passes recruiter screening and ATS keyword filters.",
    urgency: 40,
    impact: 50,
    confidence: 60,
    estimatedTimeMinutes: 90,
    metadata: {},
  });

  if (readinessScore >= 50) {
    candidates.push({
      type: CAREER_RECOMMENDATION_TYPE.HACKATHON,
      dedupeKey: buildDedupeKey(CAREER_RECOMMENDATION_TYPE.HACKATHON, "general"),
      reason: "Your fundamentals are solid enough to compete — a hackathon builds portfolio evidence and real interview stories fast.",
      urgency: 30,
      impact: 45,
      confidence: 55,
      estimatedTimeMinutes: 2880,
      metadata: {},
    });

    candidates.push({
      type: CAREER_RECOMMENDATION_TYPE.OPEN_SOURCE_CONTRIBUTION,
      dedupeKey: buildDedupeKey(CAREER_RECOMMENDATION_TYPE.OPEN_SOURCE_CONTRIBUTION, "general"),
      reason: "A merged open-source contribution is verifiable, collaborative evidence recruiters weigh highly.",
      urgency: 25,
      impact: 50,
      confidence: 55,
      estimatedTimeMinutes: 1200,
      metadata: {},
    });
  }

  return candidates.map((candidate) => ({ ...candidate, urgency: clamp(candidate.urgency), impact: clamp(candidate.impact) }));
};

module.exports = { generate };
