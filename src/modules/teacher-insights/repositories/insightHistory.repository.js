const prisma = require("../../../config/database");

/**
 * Immutable snapshot of a StudentAlert/CourseInsight/TeachingRecommendation
 * row at the moment it's retired — never updated after creation. No FK
 * relation (sourceModel + sourceId is a loose polymorphic reference,
 * spanning three different tables that Prisma can't natively FK across).
 */
const createSnapshot = (sourceModel, row, insightType, retiredReason, client = prisma) =>
  client.insightHistory.create({
    data: {
      sourceModel,
      sourceId: row.id,
      courseId: row.courseId,
      studentId: row.studentId || null,
      insightType,
      priority: row.priority,
      status: row.status,
      confidenceScore: row.confidenceScore,
      summary: row.reason || row.suggestedAction || "",
      version: row.version,
      retiredReason,
      generatedAt: row.generatedAt,
    },
  });

const findByCourse = (courseId, { skip, take } = {}, client = prisma) =>
  client.insightHistory.findMany({
    where: { courseId },
    orderBy: { retiredAt: "desc" },
    skip,
    take,
  });

const countByCourse = (courseId, client = prisma) => client.insightHistory.count({ where: { courseId } });

module.exports = { createSnapshot, findByCourse, countByCourse };
