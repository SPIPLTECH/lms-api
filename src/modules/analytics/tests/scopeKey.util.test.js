const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveScopeId, truncateToUtcDay, addDays } = require("../utils/scopeKey.util");

test("resolveScopeId collapses PLATFORM to the sentinel regardless of what's passed in", () => {
  assert.equal(resolveScopeId("PLATFORM", undefined), "platform");
  assert.equal(resolveScopeId("PLATFORM", "anything"), "platform");
});

test("resolveScopeId passes through the raw id for every other scope type", () => {
  assert.equal(resolveScopeId("STUDENT", "s1"), "s1");
  assert.equal(resolveScopeId("COURSE", "c1"), "c1");
  assert.equal(resolveScopeId("INSTRUCTOR", "t1"), "t1");
});

test("truncateToUtcDay strips the time-of-day component", () => {
  const result = truncateToUtcDay(new Date("2026-07-29T18:42:11.000Z"));
  assert.equal(result.toISOString(), "2026-07-29T00:00:00.000Z");
});

test("addDays shifts a date forward by N days", () => {
  const base = new Date("2026-07-29T00:00:00.000Z");
  assert.equal(addDays(base, 7).toISOString(), "2026-08-05T00:00:00.000Z");
});
