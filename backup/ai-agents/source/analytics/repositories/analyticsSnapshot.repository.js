const prisma = require("../../../config/database");
const { truncateToUtcDay } = require("../utils/scopeKey.util");

/** Wide daily rollup — one row per (scope, day), overwritten if the sweep runs more than once on the same day. */
const upsertDaily = (scopeType, scopeId, metrics, meta, date = new Date(), client = prisma) => {
  const day = truncateToUtcDay(date);
  return client.analyticsSnapshot.upsert({
    where: { scopeType_scopeId_date: { scopeType, scopeId, date: day } },
    create: { scopeType, scopeId, date: day, metrics, meta: meta || undefined },
    update: { metrics, meta: meta || undefined },
  });
};

const findByScopeAndRange = (scopeType, scopeId, startDate, endDate, client = prisma) =>
  client.analyticsSnapshot.findMany({
    where: { scopeType, scopeId, date: { gte: truncateToUtcDay(startDate), lte: truncateToUtcDay(endDate) } },
    orderBy: { date: "asc" },
  });

module.exports = { upsertDaily, findByScopeAndRange };
