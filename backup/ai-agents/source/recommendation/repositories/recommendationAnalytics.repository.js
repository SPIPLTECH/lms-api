const prisma = require("../../../config/database");

const startOfDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const COUNTER_FIELDS = new Set(["generatedCount", "viewedCount", "acceptedCount", "dismissedCount", "completedCount"]);

/**
 * Increments one counter on the (type, date) bucket, creating it if this is
 * the first event of the day for that type.
 *
 * @param {string} type - RECOMMENDATION_TYPE value
 * @param {"generatedCount"|"viewedCount"|"acceptedCount"|"dismissedCount"|"completedCount"} field
 * @param {Date} [date]
 */
const increment = (type, field, date = new Date(), client = prisma) => {
  if (!COUNTER_FIELDS.has(field)) throw new Error(`Unknown analytics counter field: ${field}`);
  const bucketDate = startOfDay(date);

  return client.recommendationAnalytics.upsert({
    where: { type_date: { type, date: bucketDate } },
    create: { type, date: bucketDate, [field]: 1 },
    update: { [field]: { increment: 1 } },
  });
};

const findByTypeAndDateRange = (type, startDate, endDate, client = prisma) =>
  client.recommendationAnalytics.findMany({
    where: { type, date: { gte: startOfDay(startDate), lte: startOfDay(endDate) } },
    orderBy: { date: "asc" },
  });

module.exports = { increment, findByTypeAndDateRange };
