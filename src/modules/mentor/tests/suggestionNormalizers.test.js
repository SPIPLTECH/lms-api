const test = require("node:test");
const assert = require("node:assert/strict");

const { extractRankedSuggestions } = require("../context-engine/suggestionNormalizers");

test("extractRankedSuggestions normalizes recommendation.getByStudent's priority string into a numeric urgency", () => {
  const results = [
    {
      agentName: "recommendation",
      method: "getByStudent",
      status: "SUCCESS",
      data: { recommendations: [{ type: "REVISION", priority: "HIGH", score: 80, confidenceScore: 70, reason: "Revise Module 3" }] },
    },
  ];
  const [suggestion] = extractRankedSuggestions(results);
  assert.equal(suggestion.urgency, 90);
  assert.equal(suggestion.source, "recommendation");
});

test("extractRankedSuggestions passes through admin-intelligence.getDashboard's own urgency/impact untouched", () => {
  const results = [
    {
      agentName: "admin-intelligence",
      method: "getDashboard",
      status: "SUCCESS",
      data: { recommendations: [{ type: "STAFFING_CHANGE", title: "Overloaded", urgency: 70, impact: 60, confidenceScore: 80 }] },
    },
  ];
  const [suggestion] = extractRankedSuggestions(results);
  assert.equal(suggestion.urgency, 70);
  assert.equal(suggestion.impact, 60);
});

test("extractRankedSuggestions ignores a FAILURE-status result", () => {
  const results = [{ agentName: "recommendation", method: "getByStudent", status: "FAILURE", errorMessage: "boom" }];
  assert.deepEqual(extractRankedSuggestions(results), []);
});

test("extractRankedSuggestions ignores agents with no known normalizer, without throwing", () => {
  const results = [{ agentName: "career", method: "getFullState", status: "SUCCESS", data: { readinessScore: 80 } }];
  assert.deepEqual(extractRankedSuggestions(results), []);
});

test("extractRankedSuggestions sorts by urgency*impact, highest first", () => {
  const results = [
    { agentName: "recommendation", method: "getByStudent", status: "SUCCESS", data: { recommendations: [{ priority: "LOW", score: 10, reason: "low" }] } },
    { agentName: "admin-intelligence", method: "getDashboard", status: "SUCCESS", data: { recommendations: [{ title: "high", urgency: 90, impact: 90, confidenceScore: 80 }] } },
  ];
  const ranked = extractRankedSuggestions(results);
  assert.equal(ranked[0].title, "high");
});
