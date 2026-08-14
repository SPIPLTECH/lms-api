const test = require("node:test");
const assert = require("node:assert/strict");

const { computeConfidence } = require("../services/domain/confidence");

test("computeConfidence is 0 with no attempts", () => {
  assert.equal(computeConfidence(0, []), 0);
});

test("computeConfidence grows with attempt count", () => {
  const few = computeConfidence(1, [80]);
  const many = computeConfidence(20, [80]);
  assert.ok(many > few);
});

test("computeConfidence is lower for inconsistent recent scores than consistent ones, at the same sample size", () => {
  const consistent = computeConfidence(6, [80, 82, 79, 81, 80, 78]);
  const erratic = computeConfidence(6, [10, 90, 20, 95, 15, 85]);
  assert.ok(consistent > erratic);
});

test("computeConfidence never exceeds 100 or drops below 0", () => {
  const value = computeConfidence(1000, [100, 0, 100, 0, 100, 0]);
  assert.ok(value >= 0 && value <= 100);
});
