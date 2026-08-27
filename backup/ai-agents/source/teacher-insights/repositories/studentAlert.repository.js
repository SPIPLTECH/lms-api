const prisma = require("../../../config/database");
const { INSIGHT_STATUS } = require("../constants");

const findActiveByCourse = (courseId, { alertType } = {}, client = prisma) =>
  client.studentAlert.findMany({
    where: { courseId, status: INSIGHT_STATUS.ACTIVE, alertType: alertType || undefined },
    orderBy: [{ priority: "desc" }, { confidenceScore: "desc" }],
  });

/** Every (studentId, alertType) pair currently ACTIVE for a course — used to detect which alerts no longer apply on recompute. */
const findAllActiveKeys = (courseId, client = prisma) =>
  client.studentAlert.findMany({
    where: { courseId, status: INSIGHT_STATUS.ACTIVE },
    select: { id: true, studentId: true, alertType: true },
  });

const findById = (id, client = prisma) => client.studentAlert.findUnique({ where: { id } });

const upsertCandidate = (courseId, candidate, client = prisma) =>
  client.studentAlert.upsert({
    where: { courseId_studentId_alertType: { courseId, studentId: candidate.studentId, alertType: candidate.alertType } },
    create: {
      courseId,
      studentId: candidate.studentId,
      alertType: candidate.alertType,
      priority: candidate.priority,
      status: INSIGHT_STATUS.ACTIVE,
      confidenceScore: candidate.confidence,
      reason: candidate.reason,
      evidence: candidate.evidence || undefined,
      version: 1,
    },
    update: {
      priority: candidate.priority,
      status: INSIGHT_STATUS.ACTIVE,
      confidenceScore: candidate.confidence,
      reason: candidate.reason,
      evidence: candidate.evidence || undefined,
      version: { increment: 1 },
      generatedAt: new Date(),
    },
  });

const updateStatus = (id, status, client = prisma) => client.studentAlert.update({ where: { id }, data: { status } });

const countByCourse = (courseId, client = prisma) => client.studentAlert.count({ where: { courseId } });

module.exports = { findActiveByCourse, findAllActiveKeys, findById, upsertCandidate, updateStatus, countByCourse };
