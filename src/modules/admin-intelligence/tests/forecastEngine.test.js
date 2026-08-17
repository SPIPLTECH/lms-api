const test = require("node:test");
const assert = require("node:assert/strict");

const { forecastLinear } = require("../services/domain/forecastEngine");

const day = (n) => `2026-01-${String(n).padStart(2, "0")}`;

test("forecastLinear returns null below FORECAST_MIN_DATA_POINTS", () => {
  const points = [
    { date: day(1), value: 10 },
    { date: day(2), value: 12 },
  ];
  assert.equal(forecastLinear(points), null);
});

test("forecastLinear projects a rising trend forward", () => {
  const points = [
    { date: day(1), value: 10 },
    { date: day(2), value: 20 },
    { date: day(3), value: 30 },
    { date: day(4), value: 40 },
  ];
  const result = forecastLinear(points, 1);
  assert.equal(result.method, "LINEAR_REGRESSION");
  assert.equal(result.basedOnDataPoints, 4);
  assert.ok(result.predictedValue > 40, "prediction should continue the upward trend");
  assert.ok(result.confidenceScore >= 20 && result.confidenceScore <= 90);
});

test("forecastLinear never predicts a negative value", () => {
  const points = [
    { date: day(1), value: 5 },
    { date: day(2), value: 3 },
    { date: day(3), value: 1 },
    { date: day(4), value: 0 },
  ];
  const result = forecastLinear(points, 30);
  assert.ok(result.predictedValue >= 0);
});
