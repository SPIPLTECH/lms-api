const test = require("node:test");
const assert = require("node:assert/strict");

const { computeTrend } = require("../services/domain/trend");

test("computeTrend needs at least 2 points", () => {
  assert.equal(computeTrend([]), "STABLE");
  assert.equal(computeTrend([80]), "STABLE");
});

test("computeTrend detects improvement and decline", () => {
  assert.equal(computeTrend([50, 90]), "IMPROVING");
  assert.equal(computeTrend([90, 50]), "DECLINING");
});

test("computeTrend treats small deltas as STABLE", () => {
  assert.equal(computeTrend([70, 71]), "STABLE");
});
