const test = require("node:test");
const assert = require("node:assert/strict");

const { applyEvent, refreshForInactivity } = require("../services/reducers");
const { defaultAggregate } = require("../constants/defaultDomainState.constants");
const { EVENT_TYPES } = require("../constants");
const { makeEvent } = require("./helpers/makeEvent");

test("applyEvent runs the full pipeline and stamps lastEventId/version", () => {
  const aggregate = defaultAggregate("student_1");
  const event = makeEvent({ id: "evt_1", eventType: EVENT_TYPES.USER_LOGIN });

  const next = applyEvent(aggregate, event);

  assert.equal(next.studentId, "student_1");
  assert.equal(next.state.lastEventId, "evt_1");
  assert.equal(next.state.lastEventAt, event.createdAt);
  assert.equal(next.state.version, 1);
});

test("applyEvent is a pure function — it never mutates the input aggregate", () => {
  const aggregate = defaultAggregate("student_1");
  const snapshotVersion = aggregate.state.version;

  applyEvent(aggregate, makeEvent());

  assert.equal(aggregate.state.version, snapshotVersion);
  assert.equal(aggregate.state.lastEventId, null);
});

test("applyEvent folds a realistic sequence into consistent cross-domain state", () => {
  let aggregate = defaultAggregate("student_1");

  const sequence = [
    makeEvent({ eventType: EVENT_TYPES.USER_LOGIN, sessionId: "s1", createdAt: new Date("2026-01-05T09:00:00.000Z") }),
    makeEvent({ eventType: EVENT_TYPES.COURSE_STARTED, courseId: "c1", sessionId: "s1", createdAt: new Date("2026-01-05T09:01:00.000Z") }),
    makeEvent({
      eventType: EVENT_TYPES.QUIZ_COMPLETED,
      courseId: "c1",
      quizId: "q1",
      sessionId: "s1",
      payload: { percentage: 85, passed: true },
      createdAt: new Date("2026-01-05T09:10:00.000Z"),
    }),
    makeEvent({ eventType: EVENT_TYPES.COURSE_COMPLETED, courseId: "c1", sessionId: "s2", createdAt: new Date("2026-01-06T09:00:00.000Z") }),
  ];

  for (const event of sequence) {
    aggregate = applyEvent(aggregate, event);
  }

  assert.equal(aggregate.progress.currentCourseId, "c1");
  assert.equal(aggregate.progress.courseCompletionPercent, 100);
  assert.equal(aggregate.performance.quizAverage, 85);
  assert.equal(aggregate.engagement.consecutiveLearningDays, 2);
  assert.equal(aggregate.engagement.sessionCount, 2);
  assert.equal(aggregate.state.version, 4);
  assert.ok(aggregate.state.overallLearningScore > 0);
});

test("refreshForInactivity updates risk/scores without touching lastEventId", () => {
  let aggregate = defaultAggregate("student_1");
  aggregate = applyEvent(aggregate, makeEvent({ id: "evt_1", createdAt: new Date("2026-01-01T00:00:00.000Z") }));

  const refreshed = refreshForInactivity(aggregate, new Date("2026-01-20T00:00:00.000Z"));

  assert.equal(refreshed.state.lastEventId, "evt_1"); // unchanged — no new event occurred
  assert.ok(refreshed.risk.inactivityDays >= 19);
  assert.equal(refreshed.state.version, aggregate.state.version + 1);
});
