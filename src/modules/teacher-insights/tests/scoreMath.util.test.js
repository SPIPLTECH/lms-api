const test = require("node:test");
const assert = require("node:assert/strict");

const { clamp, average, percent, daysBetween } = require("../utils/scoreMath.util");
const { buildDedupeKey } = require("../utils/dedupeKey.util");

test("clamp bounds a value to [min, max]", () => {
  assert.equal(clamp(150), 100);
  assert.equal(clamp(-10), 0);
});

test("average returns 0 for an empty array", () => {
  assert.equal(average([]), 0);
});

test("average computes the mean", () => {
  assert.equal(average([10, 20, 30]), 20);
});

test("percent returns 0 when the denominator is 0", () => {
  assert.equal(percent(5, 0), 0);
});

test("percent computes a rounded percentage", () => {
  assert.equal(percent(1, 3), 33.33);
});

test("daysBetween computes fractional days", () => {
  const earlier = new Date("2026-01-08T00:00:00.000Z");
  const later = new Date("2026-01-10T12:00:00.000Z");
  assert.equal(daysBetween(later, earlier), 2.5);
});

test("buildDedupeKey combines type and target", () => {
  assert.equal(buildDedupeKey("WEAK_CONCEPT", "algebra"), "WEAK_CONCEPT:algebra");
});
