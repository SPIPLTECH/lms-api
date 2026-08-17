const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateReadiness } = require("../ai/readinessScorer");

test("calculateReadiness returns 100 when every input signal is maxed", () => {
  const result = calculateReadiness({
    skillMatchPercent: 100,
    assessmentMasteryAvg: 100,
    studentStateComposite: 100,
    credentialCount: 10,
    activityScore: 100,
    skillSignalCount: 10,
  });
  assert.equal(result.readinessScore, 100);
  assert.equal(result.industryReadiness, "READY");
});

test("calculateReadiness returns 0 when every input signal is at rock bottom", () => {
  const result = calculateReadiness({
    skillMatchPercent: 0,
    assessmentMasteryAvg: 0,
    studentStateComposite: 0,
    credentialCount: 0,
    activityScore: 0,
    skillSignalCount: 0,
  });
  assert.equal(result.readinessScore, 0);
  assert.equal(result.industryReadiness, "NOT_READY");
  assert.equal(result.confidenceLevel, "LOW");
});

test("calculateReadiness reports LOW confidence with very few skill signals even at a high score", () => {
  const result = calculateReadiness({
    skillMatchPercent: 90,
    assessmentMasteryAvg: 90,
    studentStateComposite: 90,
    credentialCount: 5,
    activityScore: 90,
    skillSignalCount: 1,
  });
  assert.equal(result.confidenceLevel, "LOW");
});

test("calculateReadiness caps credential credit rather than rewarding unlimited certificates", () => {
  const fewCredentials = calculateReadiness({
    skillMatchPercent: 50,
    assessmentMasteryAvg: 50,
    studentStateComposite: 50,
    credentialCount: 5,
    activityScore: 50,
    skillSignalCount: 5,
  });
  const manyCredentials = calculateReadiness({
    skillMatchPercent: 50,
    assessmentMasteryAvg: 50,
    studentStateComposite: 50,
    credentialCount: 50,
    activityScore: 50,
    skillSignalCount: 5,
  });
  assert.equal(fewCredentials.readinessScore, manyCredentials.readinessScore);
});

test("calculateReadiness lands in APPROACHING for a mid-range score", () => {
  const result = calculateReadiness({
    skillMatchPercent: 60,
    assessmentMasteryAvg: 60,
    studentStateComposite: 60,
    credentialCount: 2,
    activityScore: 60,
    skillSignalCount: 5,
  });
  assert.equal(result.industryReadiness, "APPROACHING");
});
