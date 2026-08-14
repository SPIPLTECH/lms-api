const test = require("node:test");
const assert = require("node:assert/strict");

const { detect } = require("../../services/domain/detectors/weeklyGoalReminder.detector");
const { makeContext } = require("../helpers/makeContext");
const { WEEKLY_GOAL_LESSON_TARGET } = require("../../constants");

test("weeklyGoalReminder.detect stays silent with no progress data", () => {
  assert.deepEqual(detect(makeContext()), []);
});

test("weeklyGoalReminder.detect stays silent when on pace", () => {
  const context = makeContext({ learningState: { progress: { lessonsCompletedCount: WEEKLY_GOAL_LESSON_TARGET } } });
  assert.deepEqual(detect(context), []);
});

test("weeklyGoalReminder.detect fires when meaningfully behind pace", () => {
  const context = makeContext({ learningState: { progress: { lessonsCompletedCount: 0 } } });
  const [candidate] = detect(context);
  assert.equal(candidate.type, "WEEKLY_GOAL_REMINDER");
  assert.equal(candidate.dedupeKey, "weekly");
});
