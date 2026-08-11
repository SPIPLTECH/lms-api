const test = require("node:test");
const assert = require("node:assert/strict");

const { clamp, average, round2, percent, percentChange } = require("../utils/scoreMath.util");

test("clamp bounds a value to [min, max]", () => {
  assert.equal(clamp(150), 100);
  assert.equal(clamp(-10), 0);
  assert.equal(clamp(50), 50);
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

test("percentChange returns 0 on a zero-to-zero baseline", () => {
  assert.equal(percentChange(0, 0), 0);
});

test("percentChange returns 100 when growing from a zero baseline", () => {
  assert.equal(percentChange(0, 5), 100);
});

test("percentChange computes a signed percentage change", () => {
  assert.equal(percentChange(50, 75), 50);
  assert.equal(percentChange(75, 50), -33.33);
});
