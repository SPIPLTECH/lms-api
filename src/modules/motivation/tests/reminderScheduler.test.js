const test = require("node:test");
const assert = require("node:assert/strict");

const { computeNextRunAt } = require("../services/domain/reminderScheduler");

test("computeNextRunAt schedules later today when the preferred hour hasn't passed yet", () => {
  const now = new Date("2026-01-10T08:00:00.000Z");
  const next = computeNextRunAt("DAILY", 18, now);
  assert.equal(next.toISOString(), "2026-01-10T18:00:00.000Z");
});

test("computeNextRunAt rolls to tomorrow when the preferred hour has already passed", () => {
  const now = new Date("2026-01-10T20:00:00.000Z");
  const next = computeNextRunAt("DAILY", 18, now);
  assert.equal(next.toISOString(), "2026-01-11T18:00:00.000Z");
});

test("computeNextRunAt advances by 7 days for WEEKLY from the previous run", () => {
  const previousRun = new Date("2026-01-05T18:00:00.000Z");
  const now = new Date("2026-01-05T18:00:00.000Z");
  const next = computeNextRunAt("WEEKLY", 18, now, previousRun);
  assert.equal(next.toISOString(), "2026-01-12T18:00:00.000Z");
});
