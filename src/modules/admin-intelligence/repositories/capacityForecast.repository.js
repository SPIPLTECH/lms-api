const prisma = require("../../../config/database");
const { truncateToUtcDay } = require("../utils/dateMath.util");

const findByResourceType = (resourceType, client = prisma) =>
  client.capacityForecast.findMany({ where: { resourceType: resourceType || undefined }, orderBy: { forecastDate: "asc" } });

const findAll = (client = prisma) => client.capacityForecast.findMany({ orderBy: [{ resourceType: "asc" }, { forecastDate: "asc" }] });

const upsert = (forecast, client = prisma) => {
  const forecastDate = truncateToUtcDay(forecast.forecastDate);
  return client.capacityForecast.upsert({
    where: { resourceType_forecastDate: { resourceType: forecast.resourceType, forecastDate } },
    create: {
      resourceType: forecast.resourceType,
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

module.exports = { findByResourceType, findAll, upsert };
