const prisma = require("../../../config/database");
const { FEEDBACK_LOOKBACK_LIMIT } = require("../constants");

const create = ({ recommendationId, studentId, action, comment }, client = prisma) =>
  client.recommendationFeedback.create({
    data: { recommendationId, studentId, action, comment: comment || null },
  });

/** Most-recent-first, bounded — feeds feedbackAdjustment.computeAdjustmentMultiplier. */
const findRecentByStudentAndType = async (studentId, type, client = prisma) => {
  const rows = await client.recommendationFeedback.findMany({
    where: { studentId, recommendation: { type } },
    orderBy: { createdAt: "desc" },
    take: FEEDBACK_LOOKBACK_LIMIT,
    select: { action: true },
  });
  return rows;
};

const findByStudent = (studentId, { skip, take } = {}, client = prisma) =>
  client.recommendationFeedback.findMany({
    where: { studentId },
    orderBy: { createdAt: "desc" },
    skip,
    take,
  });

module.exports = { create, findRecentByStudentAndType, findByStudent };
