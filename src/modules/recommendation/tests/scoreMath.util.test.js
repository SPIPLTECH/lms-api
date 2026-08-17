const test = require("node:test");
const assert = require("node:assert/strict");

const { clamp, urgencyFromHoursRemaining } = require("../utils/scoreMath.util");
const { buildDedupeKey } = require("../utils/dedupeKey.util");

test("clamp bounds a value to [min, max]", () => {
  assert.equal(clamp(150), 100);
  assert.equal(clamp(-10), 0);
  assert.equal(clamp(50), 50);
});

test("urgencyFromHoursRemaining is 100 at/inside the near bound", () => {
  assert.equal(urgencyFromHoursRemaining(10, 24, 72), 100);
  assert.equal(urgencyFromHoursRemaining(24, 24, 72), 100);
});

test("urgencyFromHoursRemaining is 0 at/beyond the far bound", () => {
  assert.equal(urgencyFromHoursRemaining(72, 24, 72), 0);
  assert.equal(urgencyFromHoursRemaining(200, 24, 72), 0);
});

test("urgencyFromHoursRemaining ramps linearly between the bounds", () => {
  const midpoint = urgencyFromHoursRemaining(48, 24, 72);
  assert.equal(midpoint, 50);
});

test("buildDedupeKey combines type and target", () => {
  assert.equal(buildDedupeKey("REVIEW_WEAK_TOPICS", "algebra"), "REVIEW_WEAK_TOPICS:algebra");
});
