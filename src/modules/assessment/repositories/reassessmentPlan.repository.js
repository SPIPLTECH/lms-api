const prisma = require("../../../config/database");
const { REASSESSMENT_STATUS } = require("../constants");

const findPendingByStudentAndConcept = (studentId, concept, client = prisma) => {
  return client.reassessmentPlan.findFirst({
    where: { studentId, concept, status: REASSESSMENT_STATUS.PENDING },
    orderBy: { createdAt: "desc" },
  });
};

/**
 * Reschedules the existing PENDING plan for this concept if one exists,
 * otherwise creates a new one. COMPLETED/SKIPPED plans are never touched
 * — they're preserved as history, not overwritten.
 */
const upsertPending = async (studentId, concept, { scheduledFor, reason, priority }, client = prisma) => {
  const existing = await findPendingByStudentAndConcept(studentId, concept, client);

  if (existing) {
    return client.reassessmentPlan.update({
      where: { id: existing.id },
      data: { scheduledFor, reason, priority },
    });
  }

  return client.reassessmentPlan.create({
    data: { studentId, concept, scheduledFor, reason, priority, status: REASSESSMENT_STATUS.PENDING },
  });
};

const findByStudent = (studentId, { skip, take } = {}, client = prisma) => {
  return client.reassessmentPlan.findMany({
    where: { studentId },
    orderBy: { scheduledFor: "asc" },
    skip,
    take,
  });
};

const findDuePlans = (now, client = prisma) => {
  return client.reassessmentPlan.findMany({
    where: { status: REASSESSMENT_STATUS.PENDING, scheduledFor: { lte: now } },
  });
};

const markDue = (id, client = prisma) => {
  return client.reassessmentPlan.update({ where: { id }, data: { status: REASSESSMENT_STATUS.DUE } });
};

const markCompleted = (id, completedAt, client = prisma) => {
  return client.reassessmentPlan.update({
    where: { id },
    data: { status: REASSESSMENT_STATUS.COMPLETED, completedAt },
  });
};

module.exports = {
  findPendingByStudentAndConcept,
  upsertPending,
  findByStudent,
  findDuePlans,
  markDue,
  markCompleted,
};
