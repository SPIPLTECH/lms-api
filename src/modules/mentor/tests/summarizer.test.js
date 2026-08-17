const test = require("node:test");
const assert = require("node:assert/strict");

const { shouldSummarize, buildExtractiveSummary } = require("../memory/summarizer");
const { SUMMARY_TRIGGER_MESSAGE_COUNT } = require("../constants");

test("shouldSummarize is false below the trigger count", () => {
  assert.equal(shouldSummarize(SUMMARY_TRIGGER_MESSAGE_COUNT - 1), false);
});

test("shouldSummarize is true at/above the trigger count", () => {
  assert.equal(shouldSummarize(SUMMARY_TRIGGER_MESSAGE_COUNT), true);
});

test("buildExtractiveSummary lists distinct intents from USER messages only", () => {
  const messages = [
    { role: "USER", intent: "LEARNING", content: "help me study" },
    { role: "ASSISTANT", intent: null, content: "sure, here's a plan" },
    { role: "USER", intent: "LEARNING", content: "what about module 2" },
    { role: "USER", intent: "ASSESSMENT", content: "how did i score" },
  ];
  const summary = buildExtractiveSummary(messages);
  assert.match(summary.summaryText, /LEARNING, ASSESSMENT/);
  assert.equal(summary.keyTopics.length, 3);
});

test("buildExtractiveSummary handles no user messages without throwing", () => {
  const summary = buildExtractiveSummary([{ role: "ASSISTANT", intent: null, content: "hi" }]);
  assert.match(summary.summaryText, /general questions/);
});
