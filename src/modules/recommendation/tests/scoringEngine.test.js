const test = require("node:test");
const assert = require("node:assert/strict");

const { computeScore, bucketPriority } = require("../services/domain/scoringEngine");

test("computeScore blends urgency and impact using the configured weights", () => {
  const score = computeScore({ urgency: 100, impact: 0 });
  assert.equal(score, 60); // URGENCY_WEIGHT = 0.6
});

test("computeScore applies the adjustment multiplier", () => {
  const base = computeScore({ urgency: 80, impact: 80 });
  const damped = computeScore({ urgency: 80, impact: 80 }, 0.5);
  assert.equal(damped, base * 0.5);
});

test("computeScore clamps to [0, 100]", () => {
  const score = computeScore({ urgency: 100, impact: 100 }, 2);
  assert.equal(score, 100);
});

test("bucketPriority buckets at the configured thresholds", () => {
  assert.equal(bucketPriority(70), "HIGH");
  assert.equal(bucketPriority(69.9), "MEDIUM");
  assert.equal(bucketPriority(40), "MEDIUM");
  assert.equal(bucketPriority(39.9), "LOW");
});
