const prisma = require("../../../config/database");
const { CAREER_RECOMMENDATION_STATUS } = require("../constants");

const findActiveByStudent = (studentId, { type } = {}, client = prisma) =>
  client.careerRecommendation.findMany({
    where: { studentId, status: CAREER_RECOMMENDATION_STATUS.ACTIVE, type: type || undefined },
    orderBy: [{ score: "desc" }, { confidenceScore: "desc" }],
  });

const findAllActiveDedupeKeys = (studentId, client = prisma) =>
  client.careerRecommendation.findMany({
    where: { studentId, status: CAREER_RECOMMENDATION_STATUS.ACTIVE },
    select: { id: true, dedupeKey: true },
  });

const findById = (id, client = prisma) => client.careerRecommendation.findUnique({ where: { id } });

const upsertCandidate = (studentId, scored, client = prisma) =>
  client.careerRecommendation.upsert({
    where: { studentId_dedupeKey: { studentId, dedupeKey: scored.dedupeKey } },
    create: {
      studentId,
      type: scored.type,
      priority: scored.priority,
      status: CAREER_RECOMMENDATION_STATUS.ACTIVE,
      dedupeKey: scored.dedupeKey,
      score: scored.score,
      confidenceScore: scored.confidence,
      reason: scored.reason,
      estimatedTimeMinutes: scored.estimatedTimeMinutes || null,
      targetRoleId: scored.targetRoleId || null,
      metadata: scored.metadata || undefined,
      version: 1,
    },
    update: {
      priority: scored.priority,
      status: CAREER_RECOMMENDATION_STATUS.ACTIVE,
      score: scored.score,
      confidenceScore: scored.confidence,
      reason: scored.reason,
      estimatedTimeMinutes: scored.estimatedTimeMinutes || null,
      targetRoleId: scored.targetRoleId || null,
      metadata: scored.metadata || undefined,
      version: { increment: 1 },
      generatedAt: new Date(),
    },
  });

const updateStatus = (id, status, client = prisma) => client.careerRecommendation.update({ where: { id }, data: { status } });

module.exports = { findActiveByStudent, findAllActiveDedupeKeys, findById, upsertCandidate, updateStatus };
