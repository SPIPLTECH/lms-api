const test = require("node:test");
const assert = require("node:assert/strict");

const { detect } = require("../../services/domain/detectors/quizPerformanceTrend.detector");
const { makeContext } = require("../helpers/makeContext");

test("quizPerformanceTrend.detect ignores a quiz with too few submissions", () => {
  const context = makeContext({ quizzes: [{ id: "q1", title: "Quiz", submissionCount: 1, avgPercentage: 20, passRate: 0 }] });
  assert.deepEqual(detect(context), []);
});

test("quizPerformanceTrend.detect ignores a quiz with a healthy pass rate", () => {
  const context = makeContext({ quizzes: [{ id: "q1", title: "Quiz", submissionCount: 10, avgPercentage: 80, passRate: 85 }] });
  assert.deepEqual(detect(context), []);
});

test("quizPerformanceTrend.detect flags a quiz with a low pass rate and enough submissions", () => {
  const context = makeContext({ quizzes: [{ id: "q1", title: "Hard Quiz", submissionCount: 10, avgPercentage: 40, passRate: 30 }] });
  const [candidate] = detect(context);
  assert.equal(candidate.insightType, "QUIZ_PERFORMANCE_TREND");
  assert.equal(candidate.quizId, "q1");
  assert.equal(candidate.affectedStudentCount, 10);
});
