const test = require("node:test");
const assert = require("node:assert/strict");

const { detect } = require("../../services/domain/detectors/lessonCompletionTrend.detector");
const { makeContext } = require("../helpers/makeContext");

test("lessonCompletionTrend.detect stays silent with no enrollment", () => {
  const context = makeContext({ enrolledCount: 0, lessons: [{ id: "l1", title: "Intro", moduleId: "m1", completedCount: 0 }] });
  assert.deepEqual(detect(context), []);
});

test("lessonCompletionTrend.detect ignores a lesson with healthy completion", () => {
  const context = makeContext({ enrolledCount: 10, lessons: [{ id: "l1", title: "Intro", moduleId: "m1", completedCount: 9 }] });
  assert.deepEqual(detect(context), []);
});

test("lessonCompletionTrend.detect flags a lesson with low completion", () => {
  const context = makeContext({ enrolledCount: 10, lessons: [{ id: "l1", title: "Hard Lesson", moduleId: "m1", completedCount: 2 }] });
  const [candidate] = detect(context);
  assert.equal(candidate.insightType, "LESSON_COMPLETION_TREND");
  assert.equal(candidate.lessonId, "l1");
  assert.equal(candidate.affectedStudentCount, 8);
});

test("lessonCompletionTrend.detect escalates to HIGH priority for very low completion", () => {
  const context = makeContext({ enrolledCount: 10, lessons: [{ id: "l1", title: "Very Hard", moduleId: "m1", completedCount: 1 }] });
  const [candidate] = detect(context);
  assert.equal(candidate.priority, "HIGH");
});
