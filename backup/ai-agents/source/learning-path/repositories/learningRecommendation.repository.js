const prisma = require("../../../config/database");
const { RECOMMENDATION_STATUS } = require("../constants");

const findActiveByStudent = (studentId, { type } = {}, client = prisma) =>
  client.learningRecommendation.findMany({
    where: { studentId, status: RECOMMENDATION_STATUS.ACTIVE, type: type || undefined },
    orderBy: [{ priority: "desc" }, { generatedAt: "desc" }],
  });

const findAllActiveDedupeKeys = (studentId, client = prisma) =>
  client.learningRecommendation.findMany({
    where: { studentId, status: RECOMMENDATION_STATUS.ACTIVE },
    select: { id: true, dedupeKey: true },
  });

const findById = (id, client = prisma) => client.learningRecommendation.findUnique({ where: { id } });

const upsertCandidate = (studentId, candidate, client = prisma) =>
  client.learningRecommendation.upsert({
    where: { studentId_dedupeKey: { studentId, dedupeKey: candidate.dedupeKey } },
    create: {
      studentId,
      type: candidate.type,
      priority: candidate.priority,
      status: RECOMMENDATION_STATUS.ACTIVE,
      dedupeKey: candidate.dedupeKey,
      reason: candidate.reason,
      courseId: candidate.courseId || null,
      moduleId: candidate.moduleId || null,
      lessonId: candidate.lessonId || null,
      metadata: candidate.metadata || undefined,
      version: 1,
    },
    update: {
      priority: candidate.priority,
      status: RECOMMENDATION_STATUS.ACTIVE,
      reason: candidate.reason,
      courseId: candidate.courseId || null,
      moduleId: candidate.moduleId || null,
      lessonId: candidate.lessonId || null,
      metadata: candidate.metadata || undefined,
      version: { increment: 1 },
      generatedAt: new Date(),
    },
  });

const updateStatus = (id, status, client = prisma) => client.learningRecommendation.update({ where: { id }, data: { status } });

module.exports = { findActiveByStudent, findAllActiveDedupeKeys, findById, upsertCandidate, updateStatus };
