const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluateGap } = require("../services/domain/gapDetector");
const { WEAK_SCORE_THRESHOLD } = require("../constants");

test("evaluateGap ensures OPEN below the weak threshold, with severity proportional to the shortfall", () => {
  const result = evaluateGap(WEAK_SCORE_THRESHOLD - 20);
  assert.equal(result.action, "ENSURE_OPEN");
  assert.equal(result.severity, 20);
});

test("evaluateGap ensures CLOSED at or above the weak threshold", () => {
  assert.equal(evaluateGap(WEAK_SCORE_THRESHOLD).action, "ENSURE_CLOSED");
  assert.equal(evaluateGap(100).action, "ENSURE_CLOSED");
  assert.equal(evaluateGap(100).severity, 0);
});

test("evaluateGap severity is clamped to 0 at the boundary", () => {
  assert.equal(evaluateGap(0).severity, WEAK_SCORE_THRESHOLD);
});
