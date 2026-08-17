const test = require("node:test");
const assert = require("node:assert/strict");

const { reduceProgress, derivePercent } = require("../services/reducers/progress.reducer");
const { defaultProgressState } = require("../constants/defaultDomainState.constants");
const { EVENT_TYPES } = require("../constants");
const { makeEvent } = require("./helpers/makeEvent");

test("reduceProgress tracks the student's current location from any event", () => {
  const state = reduceProgress(defaultProgressState(), makeEvent({ courseId: "c1", moduleId: "m1", lessonId: "l1" }));
  assert.equal(state.currentCourseId, "c1");
  assert.equal(state.currentModuleId, "m1");
  assert.equal(state.currentLessonId, "l1");
});

test("reduceProgress sets courseCompletionPercent to 100 on COURSE_COMPLETED for the current course", () => {
  let state = reduceProgress(defaultProgressState(), makeEvent({ courseId: "c1" }));
  state = reduceProgress(state, makeEvent({ eventType: EVENT_TYPES.COURSE_COMPLETED, courseId: "c1" }));

  assert.equal(state.courseCompletionPercent, 100);
  assert.equal(state.coursesCompletedCount, 1);
});

test("reduceProgress does not mark completion for a course that isn't the current one", () => {
  let state = reduceProgress(defaultProgressState(), makeEvent({ courseId: "c1" }));
  state = reduceProgress(state, makeEvent({ eventType: EVENT_TYPES.COURSE_COMPLETED, courseId: "c2" }));

  assert.equal(state.courseCompletionPercent, 0);
  assert.equal(state.coursesCompletedCount, 1); // lifetime counter still increments
});

test("derivePercent prefers an explicit percent over position/duration", () => {
  assert.equal(derivePercent({ percent: 42, positionSeconds: 1, durationSeconds: 2 }), 42);
});

test("derivePercent falls back to positionSeconds/durationSeconds", () => {
  assert.equal(derivePercent({ positionSeconds: 30, durationSeconds: 60 }), 50);
});

test("derivePercent returns null when nothing usable is present", () => {
  assert.equal(derivePercent({}), null);
  assert.equal(derivePercent(null), null);
});

test("reduceProgress resets lessonCompletionPercent/videoProgressPercent on LESSON_STARTED", () => {
  let state = { ...defaultProgressState(), lessonCompletionPercent: 100, videoProgressPercent: 100 };
  state = reduceProgress(state, makeEvent({ eventType: EVENT_TYPES.LESSON_STARTED, lessonId: "l2" }));

  assert.equal(state.lessonCompletionPercent, 0);
  assert.equal(state.videoProgressPercent, 0);
});
