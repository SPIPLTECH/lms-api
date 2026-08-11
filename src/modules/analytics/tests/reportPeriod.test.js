const test = require("node:test");
const assert = require("node:assert/strict");

const { resolvePeriodStart } = require("../services/domain/reportPeriod");

test("resolvePeriodStart WEEKLY snaps to the ISO Monday of the current week", () => {
  const wednesday = new Date(Date.UTC(2026, 6, 29)); // 2026-07-29 is a Wednesday
  const result = resolvePeriodStart("WEEKLY", wednesday);
  assert.equal(result.toISOString().slice(0, 10), "2026-07-27"); // Monday
});

test("resolvePeriodStart MONTHLY snaps to the 1st of the month", () => {
  const result = resolvePeriodStart("MONTHLY", new Date(Date.UTC(2026, 6, 29)));
  assert.equal(result.toISOString().slice(0, 10), "2026-07-01");
});

test("resolvePeriodStart QUARTERLY snaps to the start of the current quarter", () => {
  assert.equal(resolvePeriodStart("QUARTERLY", new Date(Date.UTC(2026, 7, 15))).toISOString().slice(0, 10), "2026-07-01");
  assert.equal(resolvePeriodStart("QUARTERLY", new Date(Date.UTC(2026, 0, 15))).toISOString().slice(0, 10), "2026-01-01");
});

test("resolvePeriodStart ANNUAL snaps to Jan 1 of the current year", () => {
  const result = resolvePeriodStart("ANNUAL", new Date(Date.UTC(2026, 10, 5)));
  assert.equal(result.toISOString().slice(0, 10), "2026-01-01");
});

test("resolvePeriodStart is stable across repeated calls within the same period (get-or-generate correctness)", () => {
  const first = resolvePeriodStart("WEEKLY", new Date(Date.UTC(2026, 6, 27, 5, 5)));
  const second = resolvePeriodStart("WEEKLY", new Date(Date.UTC(2026, 6, 27, 23, 59)));
  assert.equal(first.getTime(), second.getTime());
});

test("resolvePeriodStart throws for an unknown report type", () => {
  assert.throws(() => resolvePeriodStart("DAILY", new Date()));
});
