const { RECOMMENDATION_TYPE } = require("../../../constants");

/**
 * Surfaces Assessment's own ADAPTIVE-type recommendations (agent-generated
 * quiz specs targeting specific concepts) as ATTEMPT_ADAPTIVE_QUIZ
 * candidates. Deliberately ignores Assessment's REVISION-type rows here —
 * revision.generator.js already covers "topics to review" from the raw
 * KnowledgeGap ledger, and surfacing both would double-count the same
 * underlying weak concepts under two different recommendation types.
 *
 * @param {import("../../../types/recommendation.types").StudentContext} context
 * @returns {import("../../../types/recommendation.types").Candidate[]}
 */
const generate = (context) => {
  const recommendations = context.assessment?.recommendations?.recommendations || [];
  const adaptive = recommendations.filter((rec) => rec.type === "ADAPTIVE");

  return adaptive.map((rec) => ({
    type: RECOMMENDATION_TYPE.ATTEMPT_ADAPTIVE_QUIZ,
    dedupeKey: rec.id,
    reason: rec.rationale || `An adaptive quiz targeting ${(rec.targetConcepts || []).join(", ") || "your current gaps"} is ready.`,
    urgency: 55,
    impact: 75,
    confidence: 75,
    estimatedTimeMinutes: 10,
    courseId: rec.courseId || undefined,
    metadata: { assessmentId: rec.id, targetConcepts: rec.targetConcepts, difficulty: rec.difficulty },
  }));
};

module.exports = { generate };
