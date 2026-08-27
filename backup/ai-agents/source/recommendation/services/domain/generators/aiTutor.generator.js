const { RECOMMENDATION_TYPE, STRUGGLE_QUIZ_RETRY_THRESHOLD } = require("../../../constants");

/**
 * ASK_AI_TUTOR fires when a student shows struggle signals (repeated quiz
 * retries, or elevated dropout risk) alongside at least one open knowledge
 * gap — i.e. there's something concrete to ask about, not just a generic
 * nudge. A single singleton per student (dedupeKey "general") rather than
 * per-concept, since the point is "go get help," not a specific topic.
 *
 * @param {import("../../../types/recommendation.types").StudentContext} context
 * @returns {import("../../../types/recommendation.types").Candidate[]}
 */
const generate = (context) => {
  const gaps = context.assessment?.knowledgeGaps?.gaps || [];
  if (gaps.length === 0) return [];

  const behavior = context.learningState?.behavior;
  const risk = context.learningState?.risk;

  const isStruggling = (behavior?.quizRetryCount || 0) >= STRUGGLE_QUIZ_RETRY_THRESHOLD;
  const isAtRisk = risk?.dropoutRiskLevel === "MEDIUM" || risk?.dropoutRiskLevel === "HIGH";

  if (!isStruggling && !isAtRisk) return [];

  const topGap = [...gaps].sort((a, b) => b.severity - a.severity)[0];

  return [
    {
      type: RECOMMENDATION_TYPE.ASK_AI_TUTOR,
      dedupeKey: "general",
      reason: isStruggling
        ? `Repeated quiz retries suggest "${topGap.concept}" would benefit from a guided AI tutoring session.`
        : `Your engagement signals suggest a quick AI tutoring session on "${topGap.concept}" could help you get unstuck.`,
      urgency: isAtRisk ? 60 : 45,
      impact: 50,
      confidence: 60,
      estimatedTimeMinutes: 15,
      metadata: { concept: topGap.concept, quizRetryCount: behavior?.quizRetryCount || 0 },
    },
  ];
};

module.exports = { generate };
