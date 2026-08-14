const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateCapacityForecasts } = require("../services/domain/capacityForecastEngine");

const day = 24 * 3600 * 1000;

test("calculateCapacityForecasts skips STUDENT_ENROLLMENT/COURSE_CAPACITY regression below the minimum data-point threshold", () => {
  const now = new Date();
  const context = {
    now,
    enrollments: [{ enrolledAt: now }], // 1 distinct day, well under FORECAST_MIN_DATA_POINTS
    courses: [],
    platformSnapshot: { kpis: [], trends: [] },
  };
  const forecasts = calculateCapacityForecasts(context);
  assert.ok(!forecasts.some((f) => f.resourceType === "STUDENT_ENROLLMENT"));
  assert.ok(!forecasts.some((f) => f.resourceType === "COURSE_CAPACITY"));
});

test("calculateCapacityForecasts produces a real regression forecast with enough enrollment history", () => {
  const now = new Date();
  const enrollments = Array.from({ length: 10 }, (_, i) => ({ enrolledAt: new Date(now.getTime() - i * day) }));
  const context = { now, enrollments, courses: [], platformSnapshot: { kpis: [], trends: [] } };
  const forecasts = calculateCapacityForecasts(context);
  const enrollmentForecast = forecasts.find((f) => f.resourceType === "STUDENT_ENROLLMENT");
  assert.ok(enrollmentForecast);
  assert.equal(enrollmentForecast.method, "LINEAR_REGRESSION");
});

test("calculateCapacityForecasts derives INSTRUCTOR_CAPACITY as a ratio projection capped at MAX_DERIVED_FORECAST_CONFIDENCE, never a real regression", () => {
  const now = new Date();
  const enrollments = Array.from({ length: 10 }, (_, i) => ({ enrolledAt: new Date(now.getTime() - i * day) }));
  const courses = [{ id: "c1", status: "PUBLISHED", creatorId: "i1", createdAt: now }];
  const context = { now, enrollments, courses, platformSnapshot: { kpis: [], trends: [] } };
  const forecasts = calculateCapacityForecasts(context);
  const instructorForecast = forecasts.find((f) => f.resourceType === "INSTRUCTOR_CAPACITY");
  assert.ok(instructorForecast);
  assert.equal(instructorForecast.method, "RATIO_PROJECTION");
  assert.ok(instructorForecast.confidenceScore <= 40);
});

test("calculateCapacityForecasts derives INFRASTRUCTURE_LOAD from Analytics' own SYSTEM_HEALTH KPI/trend as a trend extrapolation", () => {
  const now = new Date();
  const context = {
    now,
    enrollments: [],
    courses: [],
    platformSnapshot: { kpis: [{ metricKey: "SYSTEM_HEALTH", value: 80 }], trends: [{ metricKey: "SYSTEM_HEALTH", changePercent: 10 }] },
  };
  const forecasts = calculateCapacityForecasts(context);
  const infraForecast = forecasts.find((f) => f.resourceType === "INFRASTRUCTURE_LOAD");
  assert.ok(infraForecast);
  assert.equal(infraForecast.method, "TREND_EXTRAPOLATION");
  assert.equal(infraForecast.predictedValue, 88); // 80 * 1.10
});

test("calculateCapacityForecasts omits INFRASTRUCTURE_LOAD when Analytics hasn't computed SYSTEM_HEALTH yet", () => {
  const now = new Date();
  const context = { now, enrollments: [], courses: [], platformSnapshot: { kpis: [], trends: [] } };
  const forecasts = calculateCapacityForecasts(context);
  assert.ok(!forecasts.some((f) => f.resourceType === "INFRASTRUCTURE_LOAD"));
});
