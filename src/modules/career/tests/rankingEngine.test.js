const test = require("node:test");
const assert = require("node:assert/strict");

const { computeScore, bucketPriority } = require("../ai/scoringEngine");
const { rankAndScore } = require("../ai/rankingEngine");

test("computeScore blends urgency and impact per the configured weights", () => {
  assert.equal(computeScore({ urgency: 100, impact: 0 }), 55); // URGENCY_WEIGHT 0.55
  assert.equal(computeScore({ urgency: 0, impact: 100 }), 45); // IMPACT_WEIGHT 0.45
});

test("bucketPriority classifies by the configured thresholds", () => {
  assert.equal(bucketPriority(90), "HIGH");
  assert.equal(bucketPriority(50), "MEDIUM");
  assert.equal(bucketPriority(10), "LOW");
});

test("rankAndScore sorts highest-score-first with confidence as a tiebreaker", () => {
  const ranked = rankAndScore([
    { urgency: 10, impact: 10, confidence: 50, dedupeKey: "low" },
    { urgency: 90, impact: 90, confidence: 50, dedupeKey: "high" },
  ]);
  assert.equal(ranked[0].dedupeKey, "high");
});

test("rankAndScore never mutates the input array", () => {
  const input = [{ urgency: 50, impact: 50, confidence: 50, dedupeKey: "a" }];
  const originalLength = input.length;
  rankAndScore(input);
  assert.equal(input.length, originalLength);
  assert.equal(input[0].score, undefined);
});

test("rankAndScore caps the list at MAX_ACTIVE_RECOMMENDATIONS", () => {
  const candidates = Array.from({ length: 30 }, (_, i) => ({ urgency: 50, impact: 50, confidence: 50, dedupeKey: `c${i}` }));
  const ranked = rankAndScore(candidates);
  assert.ok(ranked.length <= 20);
});
