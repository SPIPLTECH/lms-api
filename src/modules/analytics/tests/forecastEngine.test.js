const test = require("node:test");
const assert = require("node:assert/strict");

const { forecastLinear } = require("../services/domain/forecastEngine");

const day = 24 * 3600 * 1000;
const buildLinearHistory = (points, start = 0, slope = 1) =>
  Array.from({ length: points }, (_, i) => ({ date: new Date(start + i * day), value: slope * i + 10 }));

test("forecastLinear returns null below the minimum data-point threshold", () => {
  assert.equal(forecastLinear(buildLinearHistory(2)), null);
});

test("forecastLinear extrapolates a perfectly linear series with high confidence", () => {
  const history = buildLinearHistory(10, 0, 2); // value = 2*day + 10
  const forecast = forecastLinear(history, 5);
  assert.ok(forecast);
  // last point is day 9 (value 28); 5 days ahead -> day 14 -> value 38
  assert.equal(forecast.predictedValue, 38);
  assert.equal(forecast.basedOnDataPoints, 10);
  assert.ok(forecast.confidenceScore >= 70);
});

test("forecastLinear handles unsorted input the same as sorted input", () => {
  const sorted = buildLinearHistory(5, 0, 3);
  const shuffled = [sorted[2], sorted[0], sorted[4], sorted[1], sorted[3]];
  assert.deepEqual(forecastLinear(sorted, 3), forecastLinear(shuffled, 3));
});

test("forecastLinear on a flat series predicts the same flat value", () => {
  const history = Array.from({ length: 5 }, (_, i) => ({ date: new Date(i * day), value: 50 }));
  const forecast = forecastLinear(history, 10);
  assert.equal(forecast.predictedValue, 50);
});
