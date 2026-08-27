const prisma = require("../../../config/database");

const startOfDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/** One row per (student, day) — recomputing the same day's snapshot overwrites it rather than duplicating. */
const upsertSnapshot = (studentId, { engagementScore, performanceScore, dropoutRiskScore, dailyStudyTimeSeconds }, date = new Date(), client = prisma) => {
  const bucketDate = startOfDay(date);
  return client.engagementTrend.upsert({
    where: { studentId_date: { studentId, date: bucketDate } },
    create: { studentId, date: bucketDate, engagementScore, performanceScore, dropoutRiskScore, dailyStudyTimeSeconds },
    update: { engagementScore, performanceScore, dropoutRiskScore, dailyStudyTimeSeconds },
  });
};

/** Most-recent-first, bounded — feeds trend.js's detectTrend. */
const findRecentByStudent = (studentId, limit, client = prisma) =>
  client.engagementTrend.findMany({
    where: { studentId },
    orderBy: { date: "desc" },
    take: limit,
  });

module.exports = { upsertSnapshot, findRecentByStudent };
