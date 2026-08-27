const prisma = require("../../../config/database");

const findByScope = (scopeType, scopeId, client = prisma) => client.trendAnalysis.findMany({ where: { scopeType, scopeId } });

const upsert = (scopeType, scopeId, metricKey, trend, client = prisma) =>
  client.trendAnalysis.upsert({
    where: { scopeType_scopeId_metricKey: { scopeType, scopeId, metricKey } },
    create: {
      scopeType,
      scopeId,
      metricKey,
      direction: trend.direction,
      changePercent: trend.changePercent,
      currentValue: trend.currentValue,
      previousValue: trend.previousValue,
      windowDays: trend.windowDays,
    },
    update: {
      direction: trend.direction,
      changePercent: trend.changePercent,
      currentValue: trend.currentValue,
      previousValue: trend.previousValue,
      windowDays: trend.windowDays,
      version: { increment: 1 },
      computedAt: new Date(),
    },
  });

module.exports = { findByScope, upsert };
