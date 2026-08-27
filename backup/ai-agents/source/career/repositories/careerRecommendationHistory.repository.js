const prisma = require("../../../config/database");

/** Immutable snapshot of a CareerRecommendation at the moment it's retired — never updated after creation. */
const createSnapshot = (recommendation, retiredReason, client = prisma) =>
  client.careerRecommendationHistory.create({
    data: {
      studentId: recommendation.studentId,
      recommendationId: recommendation.id,
      type: recommendation.type,
      priority: recommendation.priority,
      score: recommendation.score,
      reason: recommendation.reason,
      version: recommendation.version,
      retiredReason,
      generatedAt: recommendation.generatedAt,
    },
  });

module.exports = { createSnapshot };
