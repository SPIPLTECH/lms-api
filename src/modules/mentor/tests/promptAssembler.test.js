const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSystemPrompt, buildMessages, fillTemplate } = require("../prompt-builder/promptAssembler");

const mergedContext = {
  actor: { role: "STUDENT" },
  byAgent: { "student-state.getFullState": { overallLearningScore: 72 } },
  rankedSuggestions: [],
  notifications: [],
  recentActivity: [],
  calendarEvents: [],
};

test("fillTemplate substitutes all three placeholders", () => {
  const result = fillTemplate("A:{{context}} B:{{summary}} C:{{memory}}", { context: "1", summary: "2", memory: "3" });
  assert.equal(result, "A:1 B:2 C:3");
});

test("buildSystemPrompt embeds real byAgent data with provenance (agent.method keys), not flattened", () => {
  const prompt = buildSystemPrompt("{{context}}", mergedContext, { summaryText: null, memoryFacts: {} });
  assert.match(prompt, /"student-state.getFullState"/);
  assert.match(prompt, /"overallLearningScore": 72/);
});

test("buildSystemPrompt shows a placeholder string when there is no summary/memory yet", () => {
  const prompt = buildSystemPrompt("S:{{summary}} M:{{memory}}", mergedContext, { summaryText: null, memoryFacts: {} });
  assert.match(prompt, /S:\(none yet\)/);
  assert.match(prompt, /M:\(nothing remembered yet\)/);
});

test("buildMessages maps MentorMessage roles to Anthropic's user/assistant roles and appends the new message last", () => {
  const messages = buildMessages([{ role: "USER", content: "hi" }, { role: "ASSISTANT", content: "hello" }], "how am I doing?");
  assert.deepEqual(messages, [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "how am I doing?" },
  ]);
});
