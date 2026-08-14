const test = require("node:test");
const assert = require("node:assert/strict");

const { calculatePlacementReadiness } = require("../ai/placementReadinessScorer");

test("calculatePlacementReadiness returns 100 when every input is maxed", () => {
  const result = calculatePlacementReadiness({
    topJobMatchPercent: 100,
    interviewReadinessScore: 100,
    resumeQualityScore: 100,
    portfolioQualityScore: 100,
    careerReadinessScore: 100,
  });
  assert.equal(result, 100);
});

test("calculatePlacementReadiness returns 0 when every input is at rock bottom", () => {
  const result = calculatePlacementReadiness({
    topJobMatchPercent: 0,
    interviewReadinessScore: 0,
    resumeQualityScore: 0,
    portfolioQualityScore: 0,
    careerReadinessScore: 0,
  });
  assert.equal(result, 0);
});

test("calculatePlacementReadiness weights job match and interview readiness above resume/portfolio", () => {
  const strongMatchWeakDocs = calculatePlacementReadiness({
    topJobMatchPercent: 100,
    interviewReadinessScore: 100,
    resumeQualityScore: 0,
    portfolioQualityScore: 0,
    careerReadinessScore: 0,
  });
  const weakMatchStrongDocs = calculatePlacementReadiness({
    topJobMatchPercent: 0,
    interviewReadinessScore: 0,
    resumeQualityScore: 100,
    portfolioQualityScore: 100,
    careerReadinessScore: 0,
  });
  assert.ok(strongMatchWeakDocs > weakMatchStrongDocs);
});
