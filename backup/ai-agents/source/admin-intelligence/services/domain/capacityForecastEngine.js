const {
  CAPACITY_RESOURCE_TYPE,
  FORECAST_METHOD,
  FORECAST_HISTORY_LOOKBACK_DAYS,
  FORECAST_HORIZON_DAYS,
  MAX_DERIVED_FORECAST_CONFIDENCE,
} = require("../../constants");
const { round2 } = require("../../utils/scoreMath.util");
const { bucketByDay } = require("../../utils/growth.util");
const { forecastLinear } = require("./forecastEngine");

const DAY_MS = 24 * 3600 * 1000;

const platformKpiValue = (platformSnapshot, metricKey, fallback = 0) => {
  const kpi = (platformSnapshot?.kpis || []).find((k) => k.metricKey === metricKey);
  return typeof kpi?.value === "number" ? kpi.value : fallback;
};

const platformTrendChangePercent = (platformSnapshot, metricKey) => {
  const trend = (platformSnapshot?.trends || []).find((t) => t.metricKey === metricKey);
  return trend?.changePercent ?? 0;
};

/**
 * Two resource types get a real OLS regression forecast (forecastLinear, a
 * separate copy of Analytics' own algorithm) over day-bucketed history this
 * agent computes itself from real Enrollment/Course rows. The other two
 * have no honest daily time-series anywhere in this schema, so rather than
 * fabricate one, they get an explicitly lower-confidence derived projection
 * (method RATIO_PROJECTION / TREND_EXTRAPOLATION, capped at
 * MAX_DERIVED_FORECAST_CONFIDENCE) — never presented with the same rigor as
 * a real regression.
 *
 * @param {import("../../types/adminIntelligence.types").InstitutionContext} context
 */
const calculateCapacityForecasts = (context) => {
  const { now, enrollments, courses, platformSnapshot } = context;
  const sinceDate = new Date(now.getTime() - FORECAST_HISTORY_LOOKBACK_DAYS * DAY_MS);
  const results = [];

  const enrollmentHistory = bucketByDay(enrollments, "enrolledAt", sinceDate, now);
  const enrollmentForecast = forecastLinear(enrollmentHistory);
  if (enrollmentForecast) {
    results.push({ resourceType: CAPACITY_RESOURCE_TYPE.STUDENT_ENROLLMENT, ...enrollmentForecast });
  }

  const courseHistory = bucketByDay(courses, "createdAt", sinceDate, now);
  const courseForecast = forecastLinear(courseHistory);
  if (courseForecast) {
    results.push({ resourceType: CAPACITY_RESOURCE_TYPE.COURSE_CAPACITY, ...courseForecast });
  }

  // Ratio projection: apply the enrollment forecast's predicted daily rate
  // to the current instructor count, rather than a regression with no real
  // historical "instructor count over time" series to fit.
  const activeInstructorCount = new Set(courses.filter((c) => c.status !== "ARCHIVED").map((c) => c.creatorId)).size;
  if (enrollmentForecast && activeInstructorCount > 0) {
    const forecastDate = new Date(now.getTime() + FORECAST_HORIZON_DAYS * DAY_MS);
    results.push({
      resourceType: CAPACITY_RESOURCE_TYPE.INSTRUCTOR_CAPACITY,
      predictedValue: round2(enrollmentForecast.predictedValue / activeInstructorCount),
      confidenceScore: Math.min(enrollmentForecast.confidenceScore, MAX_DERIVED_FORECAST_CONFIDENCE),
      method: FORECAST_METHOD.RATIO_PROJECTION,
      basedOnDataPoints: enrollmentForecast.basedOnDataPoints,
      forecastDate,
    });
  }

  // Trend extrapolation: naively projects Analytics' own SYSTEM_HEALTH
  // change-percent forward — a DB-round-trip-latency proxy inherited as-is,
  // not a real infrastructure-capacity signal (no APM/infra stack exists).
  const systemHealthValue = platformKpiValue(platformSnapshot, "SYSTEM_HEALTH", null);
  if (systemHealthValue !== null) {
    const changePercent = platformTrendChangePercent(platformSnapshot, "SYSTEM_HEALTH");
    const forecastDate = new Date(now.getTime() + FORECAST_HORIZON_DAYS * DAY_MS);
    results.push({
      resourceType: CAPACITY_RESOURCE_TYPE.INFRASTRUCTURE_LOAD,
      predictedValue: round2(Math.max(0, systemHealthValue * (1 + changePercent / 100))),
      confidenceScore: MAX_DERIVED_FORECAST_CONFIDENCE,
      method: FORECAST_METHOD.TREND_EXTRAPOLATION,
      basedOnDataPoints: 1,
      forecastDate,
    });
  }

  return results;
};

module.exports = { calculateCapacityForecasts };
