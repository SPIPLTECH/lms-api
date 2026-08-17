const test = require("node:test");
const assert = require("node:assert/strict");

const { computeTrend } = require("../services/domain/trend");

test("computeTrend needs at least 2 points, defaults to STABLE", () => {
  assert.equal(computeTrend([]), "STABLE");
  assert.equal(computeTrend([50]), "STABLE");
});

test("computeTrend detects improvement when the newer half is meaningfully higher", () => {
  assert.equal(computeTrend([40, 42, 70, 75]), "IMPROVING");
});

test("computeTrend detects decline when the newer half is meaningfully lower", () => {
  assert.equal(computeTrend([80, 78, 40, 35]), "DECLINING");
});

test("computeTrend stays STABLE within the delta threshold", () => {
  assert.equal(computeTrend([50, 52, 51, 53]), "STABLE");
});
