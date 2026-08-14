const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateOverallScores,
  calculatePerformanceScore,
} = require("../services/scoreCalculator.service");
const {
  defaultProgressState,
  defaultPerformanceState,
  defaultEngagementState,
  defaultRiskState,
} = require("../constants/defaultDomainState.constants");

test("calculatePerformanceScore renormalizes across only the metrics that have data", () => {
  // The real reducer always updates quizAverage and passRate together
  // whenever quizAttemptsCount > 0 — mirror that invariant here rather
  // than constructing a state the reducer could never actually produce.
  const performance = { ...defaultPerformanceState(), quizAttemptsCount: 5, quizAverage: 80, passRate: 80 };
  const score = calculatePerformanceScore(performance);

  // Only quiz-derived metrics have data (assignmentAverage/accuracy don't)
  // — renormalized across quizAverage+passRate, both at 80, should stay 80.
  assert.equal(score, 80);
});

test("calculatePerformanceScore is 0 when there is no performance data at all", () => {
  assert.equal(calculatePerformanceScore(defaultPerformanceState()), 0);
});

test("calculateOverallScores produces all five scores in range and a fresh student scores 0", () => {
  const scores = calculateOverallScores({
    progress: defaultProgressState(),
    performance: defaultPerformanceState(),
    engagement: defaultEngagementState(),
    risk: defaultRiskState(),
  });

  for (const value of Object.values(scores)) {
    assert.ok(value >= 0 && value <= 100, `expected 0-100, got ${value}`);
  }
  assert.equal(scores.overallLearningScore, 0);
});

test("calculateOverallScores rewards a high-performing, engaged, low-risk student", () => {
  const scores = calculateOverallScores({
    progress: { ...defaultProgressState(), courseCompletionPercent: 90 },
    performance: { ...defaultPerformanceState(), quizAttemptsCount: 10, quizAverage: 95, passRate: 100 },
    engagement: { ...defaultEngagementState(), consecutiveLearningDays: 30, dailyStudyTimeSeconds: 3600 },
    risk: { ...defaultRiskState(), dropoutRiskScore: 0 },
  });

  assert.ok(scores.overallLearningScore > 80, scores.overallLearningScore);
  assert.ok(scores.learningHealthScore > 80, scores.learningHealthScore);
});
