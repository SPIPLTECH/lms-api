const prisma = require("../../../config/database");
const { truncateToUtcDay } = require("../utils/scopeKey.util");

/** Append-only per-metric daily fact — upsert-overwrite on the same day so a debounced recompute never duplicates today's row. */
const recordDaily = (scopeType, scopeId, metricKey, value, date = new Date(), client = prisma) => {
  const day = truncateToUtcDay(date);
  return client.analyticsHistory.upsert({
    where: { scopeType_scopeId_metricKey_date: { scopeType, scopeId, metricKey, date: day } },
    create: { scopeType, scopeId, metricKey, value, date: day },
    update: { value, recordedAt: new Date() },
  });
};

const findSince = (scopeType, scopeId, metricKey, sinceDate, client = prisma) =>
  client.analyticsHistory.findMany({
    where: { scopeType, scopeId, metricKey, date: { gte: truncateToUtcDay(sinceDate) } },
    orderBy: { date: "asc" },
  });

module.exports = { recordDaily, findSince };
