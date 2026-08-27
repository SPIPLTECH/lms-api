const prisma = require("../../../config/database");
const { REVISION_PLAN_STATUS } = require("../constants");

const findAllPendingKeys = (studentId, client = prisma) =>
  client.revisionPlan.findMany({ where: { studentId, status: REVISION_PLAN_STATUS.PENDING }, select: { id: true, topic: true } });

const findByStudent = (studentId, client = prisma) => client.revisionPlan.findMany({ where: { studentId } });

const upsertCandidate = (studentId, revision, client = prisma) =>
  client.revisionPlan.upsert({
    where: { studentId_topic: { studentId, topic: revision.topic } },
    create: {
      studentId,
      topic: revision.topic,
      reason: revision.reason,
      courseId: revision.courseId || null,
      status: REVISION_PLAN_STATUS.PENDING,
      version: 1,
    },
    update: {
      reason: revision.reason,
      courseId: revision.courseId || null,
      status: REVISION_PLAN_STATUS.PENDING,
      version: { increment: 1 },
    },
  });

/** A topic no longer weak on recompute is inferred resolved, not deleted. */
const markCompleted = (id, client = prisma) => client.revisionPlan.update({ where: { id }, data: { status: REVISION_PLAN_STATUS.COMPLETED } });

module.exports = { findAllPendingKeys, findByStudent, upsertCandidate, markCompleted };
