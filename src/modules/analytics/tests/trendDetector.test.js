const test = require("node:test");
const assert = require("node:assert/strict");

const { detectTrend } = require("../services/domain/trendDetector");

const daysAgo = (days) => new Date(Date.now() - days * 24 * 3600 * 1000);

test("detectTrend reports UP when current value is well above the prior window's average", () => {
  const history = [{ date: daysAgo(45), value: 40 }, { date: daysAgo(40), value: 42 }];
  const result = detectTrend(history, 80, 30);
  assert.equal(result.direction, "UP");
  assert.ok(result.changePercent > 0);
});

test("detectTrend reports DOWN when current value is well below the prior window's average", () => {
  const history = [{ date: daysAgo(45), value: 80 }, { date: daysAgo(40), value: 82 }];
  const result = detectTrend(history, 40, 30);
  assert.equal(result.direction, "DOWN");
  assert.ok(result.changePercent < 0);
});

test("detectTrend reports STABLE when the change is within the noise threshold", () => {
  const history = [{ date: daysAgo(45), value: 50 }];
  const result = detectTrend(history, 51, 30);
  assert.equal(result.direction, "STABLE");
});

test("detectTrend treats a metric with no prior-window history as STABLE rather than a fake 100% spike", () => {
  const result = detectTrend([], 42, 30);
  assert.equal(result.direction, "STABLE");
  assert.equal(result.previousValue, 42);
});

test("detectTrend ignores history rows inside the current window when computing the previous baseline", () => {
  const history = [
    { date: daysAgo(45), value: 20 }, // previous window
    { date: daysAgo(5), value: 90 }, // current window, must not count as "previous"
  ];
  const result = detectTrend(history, 100, 30);
  assert.equal(result.previousValue, 20);
});
