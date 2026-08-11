const prisma = require("../../../config/database");
const { truncateToUtcDay } = require("../utils/scopeKey.util");

const findByScope = (scopeType, scopeId, metricKey, client = prisma) =>
  client.forecast.findMany({ where: { scopeType, scopeId, metricKey: metricKey || undefined }, orderBy: { forecastDate: "asc" } });

const upsert = (scopeType, scopeId, metricKey, forecast, client = prisma) => {
  const forecastDate = truncateToUtcDay(forecast.forecastDate);
  return client.forecast.upsert({
    where: { scopeType_scopeId_metricKey_forecastDate: { scopeType, scopeId, metricKey, forecastDate } },
    create: {
      scopeType,
      scopeId,
      metricKey,
      forecastDate,
      predictedValue: forecast.predictedValue,
      confidenceScore: forecast.confidenceScore,
      method: forecast.method,
      basedOnDataPoints: forecast.basedOnDataPoints,
    },
    update: {
      predictedValue: forecast.predictedValue,
      confidenceScore: forecast.confidenceScore,
      method: forecast.method,
      basedOnDataPoints: forecast.basedOnDataPoints,
      computedAt: new Date(),
    },
  });
};

module.exports = { findByScope, upsert };
