const prisma = require("../../../config/database");

const startOfDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const COUNTER_FIELDS = new Set(["generatedCount", "resolvedCount"]);

/**
 * Increments one counter on the (courseId, insightType, date) bucket,
 * creating it if this is the first event of the day for that combination.
 *
 * @param {string} courseId
 * @param {string} insightType - value from whichever of the three source enums.
 * @param {"generatedCount"|"resolvedCount"} field
 * @param {Date} [date]
 */
const increment = (courseId, insightType, field, date = new Date(), client = prisma) => {
  if (!COUNTER_FIELDS.has(field)) throw new Error(`Unknown analytics counter field: ${field}`);
  const bucketDate = startOfDay(date);

  return client.insightAnalytics.upsert({
    where: { courseId_insightType_date: { courseId, insightType, date: bucketDate } },
    create: { courseId, insightType, date: bucketDate, [field]: 1 },
    update: { [field]: { increment: 1 } },
  });
};

const findByCourseAndDateRange = (courseId, startDate, endDate, client = prisma) =>
  client.insightAnalytics.findMany({
    where: { courseId, date: { gte: startOfDay(startDate), lte: startOfDay(endDate) } },
    orderBy: { date: "asc" },
  });

module.exports = { increment, findByCourseAndDateRange };
