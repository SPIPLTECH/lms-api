const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateInterviewReadiness } = require("../ai/interviewReadinessEngine");

test("calculateInterviewReadiness ignores history below the minimum decisive-interview count", () => {
  const withOneFailed = calculateInterviewReadiness({
    careerReadinessScore: 60,
    assessmentMasteryAvg: 60,
    interviewHistory: [{ outcome: "FAILED" }],
  });
  const withNoHistory = calculateInterviewReadiness({ careerReadinessScore: 60, assessmentMasteryAvg: 60, interviewHistory: [] });
  assert.equal(withOneFailed.interviewReadinessScore, withNoHistory.interviewReadinessScore);
  assert.equal(withOneFailed.hasInterviewHistory, false);
});

test("calculateInterviewReadiness uses real history once the minimum decisive count is met", () => {
  const allPassed = calculateInterviewReadiness({
    careerReadinessScore: 50,
    assessmentMasteryAvg: 50,
    interviewHistory: [{ outcome: "PASSED" }, { outcome: "PASSED" }],
  });
  const allFailed = calculateInterviewReadiness({
    careerReadinessScore: 50,
    assessmentMasteryAvg: 50,
    interviewHistory: [{ outcome: "FAILED" }, { outcome: "FAILED" }],
  });
  assert.equal(allPassed.hasInterviewHistory, true);
  assert.equal(allPassed.historyPassRate, 100);
  assert.equal(allFailed.historyPassRate, 0);
  assert.ok(allPassed.interviewReadinessScore > allFailed.interviewReadinessScore);
});

test("calculateInterviewReadiness ignores PENDING/SCHEDULED interviews when counting decisive history", () => {
  const result = calculateInterviewReadiness({
    careerReadinessScore: 50,
    assessmentMasteryAvg: 50,
    interviewHistory: [{ outcome: "PENDING" }, { outcome: "PENDING" }, { outcome: "PENDING" }],
  });
  assert.equal(result.hasInterviewHistory, false);
});

test("calculateInterviewReadiness returns 100 when every input is maxed with real history", () => {
  const result = calculateInterviewReadiness({
    careerReadinessScore: 100,
    assessmentMasteryAvg: 100,
    interviewHistory: [{ outcome: "PASSED" }, { outcome: "PASSED" }],
  });
  assert.equal(result.interviewReadinessScore, 100);
});
