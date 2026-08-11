const test = require("node:test");
const assert = require("node:assert/strict");

const { clamp, hoursBetween, daysBetween } = require("../utils/scoreMath.util");
const { buildDedupeKey } = require("../utils/dedupeKey.util");

test("clamp bounds a value to [min, max]", () => {
  assert.equal(clamp(150), 100);
  assert.equal(clamp(-10), 0);
});

test("hoursBetween computes positive hours forward in time", () => {
  const earlier = new Date("2026-01-10T00:00:00.000Z");
  const later = new Date("2026-01-10T06:00:00.000Z");
  assert.equal(hoursBetween(later, earlier), 6);
});

test("daysBetween computes fractional days", () => {
  const earlier = new Date("2026-01-08T00:00:00.000Z");
  const later = new Date("2026-01-10T12:00:00.000Z");
  assert.equal(daysBetween(later, earlier), 2.5);
});

test("buildDedupeKey combines type and target", () => {
  assert.equal(buildDedupeKey("INACTIVITY_ALERT", "general"), "INACTIVITY_ALERT:general");
});
