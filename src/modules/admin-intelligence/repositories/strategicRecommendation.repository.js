const prisma = require("../../../config/database");
const { RECOMMENDATION_STATUS } = require("../constants");

const findActive = ({ scopeType, type } = {}, client = prisma) =>
  client.strategicRecommendation.findMany({
    where: { status: RECOMMENDATION_STATUS.ACTIVE, scopeType: scopeType || undefined, type: type || undefined },
    orderBy: [{ urgency: "desc" }, { impact: "desc" }],
  });

const findAllActiveKeys = async (client = prisma) =>
  client.strategicRecommendation.findMany({
    where: { status: RECOMMENDATION_STATUS.ACTIVE },
    select: { id: true, scopeType: true, scopeId: true, dedupeKey: true },
  });

const upsertCandidate = (candidate, client = prisma) =>
  client.strategicRecommendation.upsert({
    where: { scopeType_scopeId_dedupeKey: { scopeType: candidate.scopeType, scopeId: candidate.scopeId, dedupeKey: candidate.dedupeKey } },
    create: {
      type: candidate.type,
      scopeType: candidate.scopeType,
      scopeId: candidate.scopeId,
      status: RECOMMENDATION_STATUS.ACTIVE,
      dedupeKey: candidate.dedupeKey,
      title: candidate.title,
      reason: candidate.reason,
      urgency: candidate.urgency,
      impact: candidate.impact,
      confidenceScore: candidate.confidenceScore,
      evidence: candidate.evidence || undefined,
      version: 1,
    },
    update: {
      status: RECOMMENDATION_STATUS.ACTIVE,
      title: candidate.title,
      reason: candidate.reason,
      urgency: candidate.urgency,
      impact: candidate.impact,
      confidenceScore: candidate.confidenceScore,
      evidence: candidate.evidence || undefined,
      version: { increment: 1 },
      generatedAt: new Date(),
    },
  });

const updateStatus = (id, status, client = prisma) => client.strategicRecommendation.update({ where: { id }, data: { status } });

module.exports = { findActive, findAllActiveKeys, upsertCandidate, updateStatus };
