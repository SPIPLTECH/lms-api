const test = require("node:test");
const assert = require("node:assert/strict");

const { reduceBehavior, derivePreferredSpeed } = require("../services/reducers/behavior.reducer");
const { defaultBehaviorState } = require("../constants/defaultDomainState.constants");
const { EVENT_TYPES } = require("../constants");
const { makeEvent } = require("./helpers/makeEvent");

test("reduceBehavior detects a rewatch when the same contentId is played again", () => {
  let state = defaultBehaviorState();
  state = reduceBehavior(state, makeEvent({ eventType: EVENT_TYPES.VIDEO_PLAYED, contentId: "c1" }));
  assert.equal(state.rewatchCount, 0);

  state = reduceBehavior(state, makeEvent({ eventType: EVENT_TYPES.VIDEO_PLAYED, contentId: "c1" }));
  assert.equal(state.rewatchCount, 1);
});

test("reduceBehavior counts a lesson skip when a new lesson starts before the previous one completed", () => {
  let state = defaultBehaviorState();
  state = reduceBehavior(state, makeEvent({ eventType: EVENT_TYPES.LESSON_STARTED, lessonId: "l1" }));
  state = reduceBehavior(state, makeEvent({ eventType: EVENT_TYPES.LESSON_STARTED, lessonId: "l2" }));

  assert.equal(state.lessonSkipCount, 1);
});

test("reduceBehavior does not count a skip when the lesson was completed first", () => {
  let state = defaultBehaviorState();
  state = reduceBehavior(state, makeEvent({ eventType: EVENT_TYPES.LESSON_STARTED, lessonId: "l1" }));
  state = reduceBehavior(state, makeEvent({ eventType: EVENT_TYPES.LESSON_COMPLETED, lessonId: "l1" }));
  state = reduceBehavior(state, makeEvent({ eventType: EVENT_TYPES.LESSON_STARTED, lessonId: "l2" }));

  assert.equal(state.lessonSkipCount, 0);
});

test("reduceBehavior counts a quiz retry on a second QUIZ_STARTED for the same quiz", () => {
  let state = defaultBehaviorState();
  state = reduceBehavior(state, makeEvent({ eventType: EVENT_TYPES.QUIZ_STARTED, quizId: "q1" }));
  state = reduceBehavior(state, makeEvent({ eventType: EVENT_TYPES.QUIZ_STARTED, quizId: "q2" }));
  state = reduceBehavior(state, makeEvent({ eventType: EVENT_TYPES.QUIZ_STARTED, quizId: "q1" }));

  assert.equal(state.quizRetryCount, 1);
  assert.deepEqual(state.startedQuizIds.sort(), ["q1", "q2"]);
});

test("reduceBehavior counts AI_HINT_REQUESTED as help requests", () => {
  let state = defaultBehaviorState();
  state = reduceBehavior(state, makeEvent({ eventType: EVENT_TYPES.AI_HINT_REQUESTED }));
  state = reduceBehavior(state, makeEvent({ eventType: EVENT_TYPES.AI_HINT_REQUESTED }));

  assert.equal(state.aiHelpRequestCount, 2);
});

test("derivePreferredSpeed buckets into SLOW/NORMAL/FAST", () => {
  assert.equal(derivePreferredSpeed(0.75), "SLOW");
  assert.equal(derivePreferredSpeed(1.0), "NORMAL");
  assert.equal(derivePreferredSpeed(1.5), "FAST");
});

test("reduceBehavior builds an hour-of-day histogram and derives the preferred hour", () => {
  let state = defaultBehaviorState();
  state = reduceBehavior(state, makeEvent({ createdAt: new Date("2026-01-05T09:00:00.000Z") }));
  state = reduceBehavior(state, makeEvent({ createdAt: new Date("2026-01-06T09:30:00.000Z") }));
  state = reduceBehavior(state, makeEvent({ createdAt: new Date("2026-01-07T14:00:00.000Z") }));

  assert.equal(state.preferredLearningHour, 9);
  assert.equal(state.hourHistogram[9], 2);
  assert.equal(state.hourHistogram[14], 1);
});
