const prisma = require("../../../config/database");

/** Immutable snapshot of a MotivationAction at the moment it's retired — never updated after creation. */
const createSnapshot = (action, retiredReason, client = prisma) =>
  client.motivationHistory.create({
    data: {
      motivationActionId: action.id,
      studentId: action.studentId,
      type: action.type,
      priority: action.priority,
      status: action.status,
      confidenceScore: action.confidenceScore,
      triggerReason: action.triggerReason,
      version: action.version,
      retiredReason,
      generatedAt: action.generatedAt,
    },
  });

const findByStudent = (studentId, { skip, take } = {}, client = prisma) =>
  client.motivationHistory.findMany({
    where: { studentId },
    orderBy: { retiredAt: "desc" },
    skip,
    take,
  });

const countByStudent = (studentId, client = prisma) => client.motivationHistory.count({ where: { studentId } });

module.exports = { createSnapshot, findByStudent, countByStudent };
