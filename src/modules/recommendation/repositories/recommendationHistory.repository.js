const prisma = require("../../../config/database");

/** Immutable snapshot of a Recommendation at the moment it's retired — never updated after creation. */
const createSnapshot = (recommendation, retiredReason, client = prisma) =>
  client.recommendationHistory.create({
    data: {
      recommendationId: recommendation.id,
      studentId: recommendation.studentId,
      type: recommendation.type,
      priority: recommendation.priority,
      status: recommendation.status,
      score: recommendation.score,
      confidenceScore: recommendation.confidenceScore,
      reason: recommendation.reason,
      version: recommendation.version,
      retiredReason,
      generatedAt: recommendation.generatedAt,
    },
  });

const findByStudent = (studentId, { skip, take } = {}, client = prisma) =>
  client.recommendationHistory.findMany({
    where: { studentId },
    orderBy: { retiredAt: "desc" },
    skip,
    take,
  });

const countByStudent = (studentId, client = prisma) => client.recommendationHistory.count({ where: { studentId } });

module.exports = { createSnapshot, findByStudent, countByStudent };
