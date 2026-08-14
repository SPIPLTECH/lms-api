const test = require("node:test");
const assert = require("node:assert/strict");

const { estimateCompletionDate } = require("../services/domain/completionEstimator");

test("estimateCompletionDate returns null when nothing remains", () => {
  assert.equal(estimateCompletionDate([], 30, new Date()), null);
});

test("estimateCompletionDate projects forward by total remaining minutes / daily pace", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const remaining = [{ estimatedMinutes: 60 }, { estimatedMinutes: 60 }]; // 120 min total
  const result = estimateCompletionDate(remaining, 60, now); // 60 min/day -> 2 days
  assert.equal(result.toISOString(), "2026-01-03T00:00:00.000Z");
});

test("estimateCompletionDate never divides by less than the minimum daily minutes", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const remaining = [{ estimatedMinutes: 100 }];
  const withZeroPace = estimateCompletionDate(remaining, 0, now);
  const withMinPace = estimateCompletionDate(remaining, 10, now);
  assert.equal(withZeroPace.getTime(), withMinPace.getTime());
});
