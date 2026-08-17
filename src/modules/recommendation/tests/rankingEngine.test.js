const test = require("node:test");
const assert = require("node:assert/strict");

const { rankAndScore } = require("../services/domain/rankingEngine");
const { MAX_ACTIVE_RECOMMENDATIONS } = require("../constants");

const candidate = (overrides = {}) => ({
  type: "CONTINUE_LEARNING",
  dedupeKey: "course_1",
  reason: "test",
  urgency: 50,
  impact: 50,
  confidence: 50,
  ...overrides,
});

test("rankAndScore sorts highest score first", () => {
  const ranked = rankAndScore([candidate({ dedupeKey: "a", urgency: 10 }), candidate({ dedupeKey: "b", urgency: 90 })]);
  assert.equal(ranked[0].dedupeKey, "b");
  assert.equal(ranked[1].dedupeKey, "a");
});

test("rankAndScore uses confidence as a tiebreaker on equal score", () => {
  const ranked = rankAndScore([
    candidate({ dedupeKey: "low-confidence", confidence: 20 }),
    candidate({ dedupeKey: "high-confidence", confidence: 90 }),
  ]);
  assert.equal(ranked[0].dedupeKey, "high-confidence");
});

test("rankAndScore caps the list at MAX_ACTIVE_RECOMMENDATIONS", () => {
  const many = Array.from({ length: MAX_ACTIVE_RECOMMENDATIONS + 10 }, (_, i) => candidate({ dedupeKey: `c${i}`, urgency: i }));
  const ranked = rankAndScore(many);
  assert.equal(ranked.length, MAX_ACTIVE_RECOMMENDATIONS);
});

test("rankAndScore applies the per-type adjustment multiplier from the lookup", () => {
  const ranked = rankAndScore([candidate({ type: "ASK_AI_TUTOR" })], (type) => (type === "ASK_AI_TUTOR" ? 0 : 1));
  assert.equal(ranked[0].score, 0);
});
