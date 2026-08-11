const prisma = require("../../../config/database");
const { MOTIVATION_STATUS } = require("../constants");

const findActiveByStudent = (studentId, { type, priority } = {}, client = prisma) =>
  client.motivationAction.findMany({
    where: {
      studentId,
      status: MOTIVATION_STATUS.ACTIVE,
      type: type || undefined,
      priority: priority || undefined,
    },
    orderBy: [{ recommendedAt: "asc" }, { generatedAt: "desc" }],
  });

/** Batch read for cross-agent consumers aggregating many students' active actions in one query (e.g. Teacher Insight's class-wide reads). */
const findActiveByStudents = (studentIds, client = prisma) =>
  client.motivationAction.findMany({
    where: { studentId: { in: studentIds }, status: MOTIVATION_STATUS.ACTIVE },
    orderBy: [{ recommendedAt: "asc" }, { generatedAt: "desc" }],
  });

const findAllActiveDedupeKeys = async (studentId, client = prisma) =>
  client.motivationAction.findMany({
    where: { studentId, status: MOTIVATION_STATUS.ACTIVE },
    select: { id: true, dedupeKey: true },
  });

const findById = (id, client = prisma) => client.motivationAction.findUnique({ where: { id } });

/** Creates a new row, or bumps version/refreshes fields on the existing one. */
const upsertCandidate = (studentId, candidate, expiresAt, client = prisma) =>
  client.motivationAction.upsert({
    where: { studentId_dedupeKey: { studentId, dedupeKey: candidate.dedupeKey } },
    create: {
      studentId,
      type: candidate.type,
      priority: candidate.priority,
      status: MOTIVATION_STATUS.ACTIVE,
      dedupeKey: candidate.dedupeKey,
      triggerReason: candidate.triggerReason,
      confidenceScore: candidate.confidence,
      recommendedAt: candidate.recommendedAt,
      courseId: candidate.courseId || null,
      moduleId: candidate.moduleId || null,
      lessonId: candidate.lessonId || null,
      metadata: candidate.metadata || undefined,
      version: 1,
      expiresAt: expiresAt || null,
    },
    update: {
      priority: candidate.priority,
      status: MOTIVATION_STATUS.ACTIVE,
      triggerReason: candidate.triggerReason,
      confidenceScore: candidate.confidence,
      recommendedAt: candidate.recommendedAt,
      courseId: candidate.courseId || null,
      moduleId: candidate.moduleId || null,
      lessonId: candidate.lessonId || null,
      metadata: candidate.metadata || undefined,
      version: { increment: 1 },
      generatedAt: new Date(),
      expiresAt: expiresAt || null,
    },
  });

const updateStatus = (id, status, client = prisma) => client.motivationAction.update({ where: { id }, data: { status } });

const findExpiredActive = (now, client = prisma) =>
  client.motivationAction.findMany({ where: { status: MOTIVATION_STATUS.ACTIVE, expiresAt: { lt: now } } });

const countByStudent = (studentId, client = prisma) => client.motivationAction.count({ where: { studentId } });

module.exports = {
  findActiveByStudent,
  findActiveByStudents,
  findAllActiveDedupeKeys,
  findById,
  upsertCandidate,
  updateStatus,
  findExpiredActive,
  countByStudent,
};
