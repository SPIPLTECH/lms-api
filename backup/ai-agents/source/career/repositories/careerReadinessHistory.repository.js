const prisma = require("../../../config/database");

const truncateToUtcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/** Append-only daily fact — upsert-overwrite on the same day so a debounced recompute never duplicates today's row. */
const recordDaily = (studentId, readinessScore, skillMatchPercent, date = new Date(), client = prisma) => {
  const day = truncateToUtcDay(date);
  return client.careerReadinessHistory.upsert({
    where: { studentId_date: { studentId, date: day } },
    create: { studentId, readinessScore, skillMatchPercent, date: day },
    update: { readinessScore, skillMatchPercent, recordedAt: new Date() },
  });
};

const findSince = (studentId, sinceDate, client = prisma) =>
  client.careerReadinessHistory.findMany({
    where: { studentId, date: { gte: truncateToUtcDay(sinceDate) } },
    orderBy: { date: "asc" },
  });

module.exports = { recordDaily, findSince };
