const test = require("node:test");
const assert = require("node:assert/strict");

const { computeAdjustmentMultiplier } = require("../services/domain/feedbackAdjustment");
const { FEEDBACK_MAX_DAMPING, FEEDBACK_MAX_BOOST } = require("../constants");

test("computeAdjustmentMultiplier returns 1 with no feedback history", () => {
  assert.equal(computeAdjustmentMultiplier([]), 1);
  assert.equal(computeAdjustmentMultiplier(undefined), 1);
});

test("computeAdjustmentMultiplier dampens below 1 for repeated negative feedback", () => {
  const multiplier = computeAdjustmentMultiplier([{ action: "DISMISSED" }, { action: "NOT_HELPFUL" }]);
  assert.ok(multiplier < 1);
});

test("computeAdjustmentMultiplier boosts above 1 for repeated positive feedback", () => {
  const multiplier = computeAdjustmentMultiplier([{ action: "HELPFUL" }, { action: "ACCEPTED" }]);
  assert.ok(multiplier > 1);
});

test("computeAdjustmentMultiplier clamps damping at the configured floor", () => {
  const manyNegative = Array.from({ length: 50 }, () => ({ action: "DISMISSED" }));
  const multiplier = computeAdjustmentMultiplier(manyNegative);
  assert.equal(multiplier, 1 - FEEDBACK_MAX_DAMPING);
});

test("computeAdjustmentMultiplier clamps boost at the configured ceiling", () => {
  const manyPositive = Array.from({ length: 50 }, () => ({ action: "HELPFUL" }));
  const multiplier = computeAdjustmentMultiplier(manyPositive);
  assert.equal(multiplier, 1 + FEEDBACK_MAX_BOOST);
});
