const prisma = require("../../../config/database");
const { RECOMMENDATION_STATUS } = require("../constants");

const findActiveByStudent = (studentId, { type, priority } = {}, client = prisma) =>
  client.recommendation.findMany({
    where: {
      studentId,
      status: RECOMMENDATION_STATUS.ACTIVE,
      type: type || undefined,
      priority: priority || undefined,
    },
    orderBy: [{ score: "desc" }, { confidenceScore: "desc" }],
  });

/** Batch read for cross-agent consumers aggregating many students' active recommendations in one query (e.g. Teacher Insight's class-wide reads). */
const findActiveByStudents = (studentIds, client = prisma) =>
  client.recommendation.findMany({
    where: { studentId: { in: studentIds }, status: RECOMMENDATION_STATUS.ACTIVE },
    orderBy: [{ score: "desc" }, { confidenceScore: "desc" }],
  });

const findAllActiveDedupeKeys = async (studentId, client = prisma) => {
  const rows = await client.recommendation.findMany({
    where: { studentId, status: RECOMMENDATION_STATUS.ACTIVE },
    select: { id: true, dedupeKey: true },
  });
  return rows;
};

const findByStudentAndDedupeKey = (studentId, dedupeKey, client = prisma) =>
  client.recommendation.findUnique({ where: { studentId_dedupeKey: { studentId, dedupeKey } } });

const findById = (id, client = prisma) => client.recommendation.findUnique({ where: { id } });

/** Creates a new row, or bumps version/refreshes fields on the existing one. */
const upsertCandidate = (studentId, scored, expiresAt, client = prisma) =>
  client.recommendation.upsert({
    where: { studentId_dedupeKey: { studentId, dedupeKey: scored.dedupeKey } },
    create: {
      studentId,
      type: scored.type,
      priority: scored.priority,
      status: RECOMMENDATION_STATUS.ACTIVE,
      dedupeKey: scored.dedupeKey,
      score: scored.score,
      confidenceScore: scored.confidence,
      reason: scored.reason,
      estimatedTimeMinutes: scored.estimatedTimeMinutes || null,
      courseId: scored.courseId || null,
      moduleId: scored.moduleId || null,
      lessonId: scored.lessonId || null,
      metadata: scored.metadata || undefined,
      version: 1,
      expiresAt: expiresAt || null,
    },
    update: {
      priority: scored.priority,
      status: RECOMMENDATION_STATUS.ACTIVE,
      score: scored.score,
      confidenceScore: scored.confidence,
      reason: scored.reason,
      estimatedTimeMinutes: scored.estimatedTimeMinutes || null,
      courseId: scored.courseId || null,
      moduleId: scored.moduleId || null,
      lessonId: scored.lessonId || null,
      metadata: scored.metadata || undefined,
      version: { increment: 1 },
      generatedAt: new Date(),
      expiresAt: expiresAt || null,
    },
  });

const updateStatus = (id, status, client = prisma) => client.recommendation.update({ where: { id }, data: { status } });

const findExpiredActive = (now, client = prisma) =>
  client.recommendation.findMany({
    where: { status: RECOMMENDATION_STATUS.ACTIVE, expiresAt: { lt: now } },
  });

const countByStudent = (studentId, client = prisma) => client.recommendation.count({ where: { studentId } });

module.exports = {
  findActiveByStudent,
  findActiveByStudents,
  findAllActiveDedupeKeys,
  findByStudentAndDedupeKey,
  findById,
  upsertCandidate,
  updateStatus,
  findExpiredActive,
  countByStudent,
};
