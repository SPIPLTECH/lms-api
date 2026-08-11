const test = require("node:test");
const assert = require("node:assert/strict");

const { reducePerformance, computeTrend, rankTopics } = require("../services/reducers/performance.reducer");
const { defaultPerformanceState } = require("../constants/defaultDomainState.constants");
const { EVENT_TYPES } = require("../constants");
const { makeEvent } = require("./helpers/makeEvent");

test("reducePerformance accumulates quiz average and pass rate", () => {
  let state = defaultPerformanceState();
  state = reducePerformance(state, makeEvent({ eventType: EVENT_TYPES.QUIZ_COMPLETED, payload: { percentage: 80, passed: true } }));
  state = reducePerformance(state, makeEvent({ eventType: EVENT_TYPES.QUIZ_COMPLETED, payload: { percentage: 60, passed: false } }));

  assert.equal(state.quizAttemptsCount, 2);
  assert.equal(state.quizAverage, 70);
  assert.equal(state.quizPassCount, 1);
  assert.equal(state.passRate, 50);
});

test("reducePerformance derives percentage from score/totalMarks when percentage is absent", () => {
  const state = reducePerformance(
    defaultPerformanceState(),
    makeEvent({ eventType: EVENT_TYPES.QUIZ_COMPLETED, payload: { score: 8, totalMarks: 10, passed: true } })
  );

  assert.equal(state.quizAverage, 80);
});

test("reducePerformance tracks answer accuracy from QUIZ_QUESTION_ANSWERED", () => {
  let state = defaultPerformanceState();
  state = reducePerformance(state, makeEvent({ eventType: EVENT_TYPES.QUIZ_QUESTION_ANSWERED, payload: { isCorrect: true } }));
  state = reducePerformance(state, makeEvent({ eventType: EVENT_TYPES.QUIZ_QUESTION_ANSWERED, payload: { isCorrect: false } }));
  state = reducePerformance(state, makeEvent({ eventType: EVENT_TYPES.QUIZ_QUESTION_ANSWERED, payload: { isCorrect: true } }));

  assert.equal(state.totalAnswersCount, 3);
  assert.equal(state.correctAnswersCount, 2);
  assert.ok(Math.abs(state.accuracy - 66.67) < 0.1);
});

test("reducePerformance only accumulates assignmentAverage when scorePercent is supplied", () => {
  let state = defaultPerformanceState();
  state = reducePerformance(state, makeEvent({ eventType: EVENT_TYPES.ASSIGNMENT_SUBMITTED, payload: {} }));
  assert.equal(state.assignmentAttemptsCount, 1);
  assert.equal(state.assignmentAverage, 0);

  state = reducePerformance(state, makeEvent({ eventType: EVENT_TYPES.ASSIGNMENT_SUBMITTED, payload: { scorePercent: 90 } }));
  assert.equal(state.assignmentAttemptsCount, 2);
  assert.equal(state.assignmentAverage, 90);
});

test("reducePerformance merges conceptScores into topicStats and ranks weak/strong topics", () => {
  let state = defaultPerformanceState();
  state = reducePerformance(
    state,
    makeEvent({ eventType: EVENT_TYPES.QUIZ_COMPLETED, payload: { percentage: 50, conceptScores: { algebra: 0.9, geometry: 0.2 } } })
  );
  state = reducePerformance(
    state,
    makeEvent({ eventType: EVENT_TYPES.QUIZ_COMPLETED, payload: { percentage: 50, conceptScores: { algebra: 0.8, geometry: 0.1 } } })
  );

  assert.deepEqual(state.weakTopics[0], "geometry");
  assert.deepEqual(state.strongTopics[0], "algebra");
});

test("computeTrend needs at least 2 points and detects improvement/decline", () => {
  assert.equal(computeTrend([80]), "STABLE");
  assert.equal(computeTrend([50, 90]), "IMPROVING");
  assert.equal(computeTrend([90, 50]), "DECLINING");
  assert.equal(computeTrend([70, 71]), "STABLE");
});

test("rankTopics excludes topics below the minimum-attempts threshold", () => {
  const topicStats = {
    algebra: { correctSum: 1.8, total: 2 },
    geometry: { correctSum: 0.2, total: 1 }, // below MIN_ATTEMPTS_FOR_TOPIC_RANKING
  };
  const { weak, strong } = rankTopics(topicStats);
  assert.ok(!weak.includes("geometry"));
  assert.ok(!strong.includes("geometry"));
  assert.ok(weak.includes("algebra"));
});
