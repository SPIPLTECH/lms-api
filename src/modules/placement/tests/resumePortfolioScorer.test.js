const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateResumePortfolioScores } = require("../ai/resumePortfolioScorer");

test("calculateResumePortfolioScores returns 100/100 when every signal is maxed", () => {
  const result = calculateResumePortfolioScores({ credentialCount: 10, skillCount: 20, profileCompletenessRatio: 1 });
  assert.equal(result.resumeQualityScore, 100);
  assert.equal(result.portfolioQualityScore, 100);
});

test("calculateResumePortfolioScores returns 0/0 when every signal is at rock bottom", () => {
  const result = calculateResumePortfolioScores({ credentialCount: 0, skillCount: 0, profileCompletenessRatio: 0 });
  assert.equal(result.resumeQualityScore, 0);
  assert.equal(result.portfolioQualityScore, 0);
});

test("calculateResumePortfolioScores caps credential/skill credit rather than rewarding unlimited counts", () => {
  const capped = calculateResumePortfolioScores({ credentialCount: 5, skillCount: 10, profileCompletenessRatio: 0.5 });
  const overCapped = calculateResumePortfolioScores({ credentialCount: 50, skillCount: 100, profileCompletenessRatio: 0.5 });
  assert.deepEqual(capped, overCapped);
});
