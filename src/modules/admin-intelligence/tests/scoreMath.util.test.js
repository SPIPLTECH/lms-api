const test = require("node:test");
const assert = require("node:assert/strict");

const { clamp, average, round2, percent, percentChange } = require("../utils/scoreMath.util");

test("clamp bounds a value within [min, max]", () => {
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

test("percent handles a zero denominator without throwing", () => {
  assert.equal(percent(5, 0), 0);
});

test("percentChange handles a zero baseline without Infinity/NaN", () => {
  assert.equal(percentChange(0, 0), 0);
  assert.equal(percentChange(0, 10), 100);
});

test("percentChange computes a normal ratio", () => {
  assert.equal(percentChange(50, 100), 100);
});

test("round2 rounds to two decimal places", () => {
  assert.equal(round2(1.23456), 1.23);
});
