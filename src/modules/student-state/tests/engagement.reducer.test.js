const test = require("node:test");
const assert = require("node:assert/strict");

const { reduceEngagement } = require("../services/reducers/engagement.reducer");
const { defaultEngagementState } = require("../constants/defaultDomainState.constants");
const { EVENT_TYPES } = require("../constants");
const { makeEvent } = require("./helpers/makeEvent");

test("reduceEngagement accrues study time only when payload.durationSeconds is present", () => {
  let state = defaultEngagementState();
  state = reduceEngagement(state, makeEvent({ payload: { durationSeconds: 120 } }));

  assert.equal(state.dailyStudyTimeSeconds, 120);
  assert.equal(state.weeklyStudyTimeSeconds, 120);
  assert.equal(state.totalStudyTimeSeconds, 120);

  state = reduceEngagement(state, makeEvent({ payload: null }));
  assert.equal(state.totalStudyTimeSeconds, 120); // unchanged, no duration supplied
});

test("reduceEngagement resets the daily bucket on a new UTC day but keeps the weekly total", () => {
  let state = defaultEngagementState();
  state = reduceEngagement(state, makeEvent({ payload: { durationSeconds: 100 }, createdAt: new Date("2026-01-05T10:00:00.000Z") }));
  state = reduceEngagement(state, makeEvent({ payload: { durationSeconds: 50 }, createdAt: new Date("2026-01-06T10:00:00.000Z") }));

  assert.equal(state.dailyStudyTimeSeconds, 50);
  assert.equal(state.weeklyStudyTimeSeconds, 150);
});

test("reduceEngagement advances consecutiveLearningDays on consecutive days and resets on a gap", () => {
  let state = defaultEngagementState();
  state = reduceEngagement(state, makeEvent({ createdAt: new Date("2026-01-05T10:00:00.000Z") }));
  assert.equal(state.consecutiveLearningDays, 1);

  state = reduceEngagement(state, makeEvent({ createdAt: new Date("2026-01-06T10:00:00.000Z") }));
  assert.equal(state.consecutiveLearningDays, 2);

  state = reduceEngagement(state, makeEvent({ createdAt: new Date("2026-01-10T10:00:00.000Z") })); // 4-day gap
  assert.equal(state.consecutiveLearningDays, 1);
});

test("reduceEngagement only advances loginStreakDays on USER_LOGIN events", () => {
  let state = defaultEngagementState();
  state = reduceEngagement(state, makeEvent({ eventType: EVENT_TYPES.PAGE_VIEWED, createdAt: new Date("2026-01-05T10:00:00.000Z") }));
  assert.equal(state.loginStreakDays, 0);

  state = reduceEngagement(state, makeEvent({ eventType: EVENT_TYPES.USER_LOGIN, createdAt: new Date("2026-01-06T10:00:00.000Z") }));
  assert.equal(state.loginStreakDays, 1);
});

test("reduceEngagement finalizes a session's duration when a new sessionId appears", () => {
  let state = defaultEngagementState();
  state = reduceEngagement(state, makeEvent({ sessionId: "s1", createdAt: new Date("2026-01-05T10:00:00.000Z") }));
  state = reduceEngagement(state, makeEvent({ sessionId: "s1", createdAt: new Date("2026-01-05T10:05:00.000Z") }));
  assert.equal(state.sessionCount, 1);

  state = reduceEngagement(state, makeEvent({ sessionId: "s2", createdAt: new Date("2026-01-05T10:20:00.000Z") }));

  assert.equal(state.sessionCount, 2);
  assert.equal(state.totalSessionDurationSeconds, 300); // 5 minutes for session s1
  assert.equal(state.averageSessionDurationSeconds, 300);
});
