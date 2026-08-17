const test = require("node:test");
const assert = require("node:assert/strict");

const { classifyIntent, isBelowConfidenceThreshold } = require("../intent-engine/classifier");

test("classifyIntent recognizes a learning-shaped message", () => {
  const result = classifyIntent("Can you help me build a study plan for revision?");
  assert.equal(result.intent, "LEARNING");
  assert.ok(result.confidence > 0);
});

test("classifyIntent recognizes a placement-shaped message", () => {
  const result = classifyIntent("I need help with my resume for placement interviews");
  assert.equal(result.intent, "PLACEMENT");
});

test("classifyIntent recognizes a technical-support-shaped message via a phrase, not just words", () => {
  const result = classifyIntent("The quiz page is not working, I can't access it");
  assert.equal(result.intent, "TECHNICAL_SUPPORT");
});

test("classifyIntent falls back to GENERAL with 0 confidence on no keyword match", () => {
  const result = classifyIntent("asdkjaslkdj random gibberish");
  assert.equal(result.intent, "GENERAL");
  assert.equal(result.confidence, 0);
});

test("classifyIntent is case-insensitive", () => {
  const lower = classifyIntent("what quiz should i take");
  const upper = classifyIntent("WHAT QUIZ SHOULD I TAKE");
  assert.equal(lower.intent, upper.intent);
});

test("isBelowConfidenceThreshold is true for GENERAL/no-match messages", () => {
  assert.equal(isBelowConfidenceThreshold(classifyIntent("")), true);
});

test("isBelowConfidenceThreshold is false once a real keyword phrase matches", () => {
  assert.equal(isBelowConfidenceThreshold(classifyIntent("what should i do next in my career roadmap")), false);
});
