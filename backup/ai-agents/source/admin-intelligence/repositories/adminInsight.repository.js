const prisma = require("../../../config/database");
const { INSIGHT_STATUS } = require("../constants");

const findActive = ({ scopeType, category } = {}, client = prisma) =>
  client.adminInsight.findMany({
    where: { status: INSIGHT_STATUS.ACTIVE, scopeType: scopeType || undefined, category: category || undefined },
    orderBy: [{ priority: "desc" }, { generatedAt: "desc" }],
  });

const findAllActiveKeys = async (client = prisma) =>
  client.adminInsight.findMany({ where: { status: INSIGHT_STATUS.ACTIVE }, select: { id: true, scopeType: true, scopeId: true, dedupeKey: true } });

/** Creates a new row, or bumps version/refreshes fields on the existing one — same current-row shape as Recommendation Agent's own upsertCandidate. */
const upsertCandidate = (candidate, client = prisma) =>
  client.adminInsight.upsert({
    where: { scopeType_scopeId_dedupeKey: { scopeType: candidate.scopeType, scopeId: candidate.scopeId, dedupeKey: candidate.dedupeKey } },
    create: {
      category: candidate.category,
      scopeType: candidate.scopeType,
      scopeId: candidate.scopeId,
      status: INSIGHT_STATUS.ACTIVE,
      dedupeKey: candidate.dedupeKey,
      title: candidate.title,
      summary: candidate.summary,
      priority: candidate.priority,
      confidenceScore: candidate.confidenceScore,
      evidence: candidate.evidence || undefined,
      version: 1,
    },
    update: {
      status: INSIGHT_STATUS.ACTIVE,
      title: candidate.title,
      summary: candidate.summary,
      priority: candidate.priority,
      confidenceScore: candidate.confidenceScore,
      evidence: candidate.evidence || undefined,
      version: { increment: 1 },
      generatedAt: new Date(),
    },
  });

const updateStatus = (id, status, client = prisma) => client.adminInsight.update({ where: { id }, data: { status } });

module.exports = { findActive, findAllActiveKeys, upsertCandidate, updateStatus };
