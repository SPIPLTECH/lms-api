const prisma = require("../../../config/database");
const { truncateToUtcDay } = require("../utils/dateMath.util");

/** Append-only per-metric daily fact — upsert-overwrite on the same day, same shape as Analytics' analyticsHistory.repository.js#recordDaily. */
const recordDaily = (metricKey, value, unit, date = new Date(), client = prisma) => {
  const day = truncateToUtcDay(date);
  return client.governanceMetric.upsert({
    where: { metricKey_date: { metricKey, date: day } },
    create: { metricKey, value, unit: unit || null, date: day },
    update: { value, unit: unit || null, computedAt: new Date() },
  });
};

const findByMetric = (metricKey, sinceDate, client = prisma) =>
  client.governanceMetric.findMany({
    where: { metricKey, date: { gte: truncateToUtcDay(sinceDate) } },
    orderBy: { date: "asc" },
  });

/** Latest row per metricKey — for GET /admin-intelligence/compliance's current-state view. */
const findLatestAll = async (client = prisma) => {
  const rows = await client.governanceMetric.findMany({ orderBy: { date: "desc" } });
  const latestByMetric = new Map();
  for (const row of rows) {
    if (!latestByMetric.has(row.metricKey)) latestByMetric.set(row.metricKey, row);
  }
  return [...latestByMetric.values()];
};

module.exports = { recordDaily, findByMetric, findLatestAll };
