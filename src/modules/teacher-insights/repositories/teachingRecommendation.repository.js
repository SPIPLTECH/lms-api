const prisma = require("../../../config/database");
const { INSIGHT_STATUS } = require("../constants");

const findActiveByCourse = (courseId, client = prisma) =>
  client.teachingRecommendation.findMany({
    where: { courseId, status: INSIGHT_STATUS.ACTIVE },
    orderBy: [{ priority: "desc" }, { confidenceScore: "desc" }],
  });

const findAllActiveKeys = (courseId, client = prisma) =>
  client.teachingRecommendation.findMany({
    where: { courseId, status: INSIGHT_STATUS.ACTIVE },
    select: { id: true, recommendationType: true, dedupeKey: true },
  });

const findById = (id, client = prisma) => client.teachingRecommendation.findUnique({ where: { id } });

const upsertCandidate = (courseId, candidate, client = prisma) =>
  client.teachingRecommendation.upsert({
    where: {
      courseId_recommendationType_dedupeKey: { courseId, recommendationType: candidate.recommendationType, dedupeKey: candidate.dedupeKey },
    },
    create: {
      courseId,
      recommendationType: candidate.recommendationType,
      dedupeKey: candidate.dedupeKey,
      priority: candidate.priority,
      status: INSIGHT_STATUS.ACTIVE,
      confidenceScore: candidate.confidence,
      suggestedAction: candidate.suggestedAction,
      reason: candidate.reason,
      affectedStudentCount: candidate.affectedStudentCount || 0,
      evidence: candidate.evidence || undefined,
      version: 1,
    },
    update: {
      priority: candidate.priority,
      status: INSIGHT_STATUS.ACTIVE,
      confidenceScore: candidate.confidence,
      suggestedAction: candidate.suggestedAction,
      reason: candidate.reason,
      affectedStudentCount: candidate.affectedStudentCount || 0,
      evidence: candidate.evidence || undefined,
      version: { increment: 1 },
      generatedAt: new Date(),
    },
  });

const updateStatus = (id, status, client = prisma) => client.teachingRecommendation.update({ where: { id }, data: { status } });

const countByCourse = (courseId, client = prisma) => client.teachingRecommendation.count({ where: { courseId } });

module.exports = { findActiveByCourse, findAllActiveKeys, findById, upsertCandidate, updateStatus, countByCourse };
