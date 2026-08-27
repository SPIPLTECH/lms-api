const prisma = require("../../../config/database");

const truncateToUtcDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/** Append-only daily snapshot — upsert-overwrite on the same day so a debounced recompute never duplicates today's row. */
const recordDaily = (studentId, { resumeQualityScore, portfolioQualityScore, suggestions }, date = new Date(), client = prisma) => {
  const day = truncateToUtcDay(date);
  return client.resumeReview.upsert({
    where: { studentId_date: { studentId, date: day } },
    create: { studentId, resumeQualityScore, portfolioQualityScore, suggestions, date: day },
    update: { resumeQualityScore, portfolioQualityScore, suggestions },
  });
};

const findLatestByStudent = (studentId, client = prisma) =>
  client.resumeReview.findFirst({ where: { studentId }, orderBy: { date: "desc" } });

module.exports = { recordDaily, findLatestByStudent };
