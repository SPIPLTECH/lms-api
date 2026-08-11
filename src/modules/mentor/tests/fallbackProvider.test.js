const test = require("node:test");
const assert = require("node:assert/strict");

const { buildFallbackReply } = require("../llm/fallbackProvider");

const emptyContext = { rankedSuggestions: [], notifications: [], recentActivity: [] };

test("buildFallbackReply always leads with the fallback notice", () => {
  const reply = buildFallbackReply({ fallbackNotice: "NOTICE", mergedContext: emptyContext });
  assert.ok(reply.text.startsWith("NOTICE"));
  assert.equal(reply.model, "fallback");
});

test("buildFallbackReply lists real ranked suggestions, not invented ones", () => {
  const mergedContext = { ...emptyContext, rankedSuggestions: [{ source: "recommendation", title: "Revise Module 3" }] };
  const reply = buildFallbackReply({ fallbackNotice: "NOTICE", mergedContext });
  assert.match(reply.text, /\[recommendation\] Revise Module 3/);
});

test("buildFallbackReply says so honestly when there's nothing to report", () => {
  const reply = buildFallbackReply({ fallbackNotice: "NOTICE", mergedContext: emptyContext });
  assert.match(reply.text, /couldn't find any relevant data/);
});

test("buildFallbackReply never claims LLM-generated reasoning (model is always 'fallback')", () => {
  const reply = buildFallbackReply({ fallbackNotice: "NOTICE", mergedContext: emptyContext });
  assert.equal(reply.inputTokens, 0);
  assert.equal(reply.outputTokens, 0);
});
