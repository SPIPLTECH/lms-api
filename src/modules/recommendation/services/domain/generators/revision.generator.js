const { RECOMMENDATION_TYPE } = require("../../../constants");
const { clamp, round2 } = require("../../../utils/scoreMath.util");

/**
 * One REVIEW_WEAK_TOPICS candidate per open KnowledgeGap the Assessment
 * Agent has already detected — this generator never re-derives mastery
 * itself, it only reads Assessment's authoritative, already-vetted gap
 * ledger (getKnowledgeGaps only ever returns status=OPEN rows).
 *
 * @param {import("../../../types/recommendation.types").StudentContext} context
 * @returns {import("../../../types/recommendation.types").Candidate[]}
 */
const generate = (context) => {
  const gaps = context.assessment?.knowledgeGaps?.gaps || [];

  return gaps.map((gap) => ({
    type: RECOMMENDATION_TYPE.REVIEW_WEAK_TOPICS,
    dedupeKey: gap.concept,
    reason: `"${gap.concept}" is a detected weak spot — a quick review now prevents it compounding.`,
    urgency: clamp(round2(gap.severity)),
    impact: clamp(round2(gap.severity * 0.9 + 10)),
    confidence: 80,
    estimatedTimeMinutes: 15,
    metadata: { concept: gap.concept, severity: gap.severity, detectedAt: gap.detectedAt },
  }));
};

module.exports = { generate };
