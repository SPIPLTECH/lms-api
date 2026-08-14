const test = require("node:test");
const assert = require("node:assert/strict");

const { rankInsights } = require("../services/domain/rankingEngine");

test("rankInsights sorts HIGH before MEDIUM before LOW", () => {
  const ranked = rankInsights([
    { id: "low", priority: "LOW", confidence: 50 },
    { id: "high", priority: "HIGH", confidence: 50 },
    { id: "medium", priority: "MEDIUM", confidence: 50 },
  ]);
  assert.deepEqual(
    ranked.map((r) => r.id),
    ["high", "medium", "low"]
  );
});

test("rankInsights uses confidence as a tiebreaker within the same priority", () => {
  const ranked = rankInsights([
    { id: "low-confidence", priority: "HIGH", confidence: 40 },
    { id: "high-confidence", priority: "HIGH", confidence: 90 },
  ]);
  assert.equal(ranked[0].id, "high-confidence");
});

test("rankInsights accepts confidenceScore as an alias for confidence", () => {
  const ranked = rankInsights([
    { id: "a", priority: "MEDIUM", confidenceScore: 30 },
    { id: "b", priority: "MEDIUM", confidenceScore: 80 },
  ]);
  assert.equal(ranked[0].id, "b");
});

test("rankInsights does not mutate the input array", () => {
  const input = [
    { id: "a", priority: "LOW", confidence: 50 },
    { id: "b", priority: "HIGH", confidence: 50 },
  ];
  const copy = [...input];
  rankInsights(input);
  assert.deepEqual(input, copy);
});
