const test = require("node:test");
const assert = require("node:assert/strict");

const { rankOpportunities, computeUrgency, bucketPriority } = require("../ai/opportunityRanker");

const day = 24 * 3600 * 1000;

test("computeUrgency returns a mild baseline for opportunities with no deadline", () => {
  assert.equal(computeUrgency(null, new Date()), 30);
});

test("computeUrgency floors to 0 once the deadline has passed", () => {
  const now = new Date();
  assert.equal(computeUrgency(new Date(now.getTime() - day), now), 0);
});

test("computeUrgency increases as the deadline approaches", () => {
  const now = new Date();
  const soon = computeUrgency(new Date(now.getTime() + 2 * day), now);
  const later = computeUrgency(new Date(now.getTime() + 13 * day), now);
  assert.ok(soon > later);
});

test("bucketPriority classifies by the configured thresholds", () => {
  assert.equal(bucketPriority(90), "HIGH");
  assert.equal(bucketPriority(50), "MEDIUM");
  assert.equal(bucketPriority(10), "LOW");
});

test("rankOpportunities sorts by blended score, highest first", () => {
  const now = new Date();
  const candidates = [
    { opportunity: { applicationDeadline: null }, matchPercent: 40 },
    { opportunity: { applicationDeadline: null }, matchPercent: 90 },
  ];
  const ranked = rankOpportunities(candidates, now);
  assert.equal(ranked[0].matchPercent, 90);
});

test("rankOpportunities caps the list at TOP_MATCHES_COUNT", () => {
  const now = new Date();
  const candidates = Array.from({ length: 30 }, (_, i) => ({ opportunity: { applicationDeadline: null }, matchPercent: i }));
  const ranked = rankOpportunities(candidates, now);
  assert.ok(ranked.length <= 15);
});

test("rankOpportunities lets a looming deadline outrank a slightly better match with no deadline", () => {
  const now = new Date();
  const candidates = [
    { id: "no-deadline", opportunity: { applicationDeadline: null }, matchPercent: 60 },
    { id: "urgent", opportunity: { applicationDeadline: new Date(now.getTime() + day) }, matchPercent: 59 },
  ];
  const ranked = rankOpportunities(candidates, now);
  assert.equal(ranked[0].id, "urgent");
});
