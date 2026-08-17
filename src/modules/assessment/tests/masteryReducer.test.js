const test = require("node:test");
const assert = require("node:assert/strict");

const { defaultConceptMasteryState, deriveStatus, applyEvidence } = require("../services/domain/masteryReducer");
const { MASTERY_STATUS } = require("../constants");

const evidence = (scorePercent, overrides = {}) => ({
  concept: "algebra",
  scorePercent,
  courseId: "course_1",
  sourceEventId: "evt_1",
  evidenceType: "QUIZ",
  observedAt: new Date("2026-01-05T10:00:00.000Z"),
  ...overrides,
});

test("applyEvidence sets masteryScore directly on the first-ever observation", () => {
  const next = applyEvidence(defaultConceptMasteryState("algebra"), evidence(80), new Date("2026-01-05T10:00:00.000Z"));
  assert.equal(next.masteryScore, 80);
  assert.equal(next.attemptsCount, 1);
});

test("applyEvidence blends subsequent observations via EMA, not a plain average", () => {
  let state = defaultConceptMasteryState("algebra");
  state = applyEvidence(state, evidence(80), new Date("2026-01-05T10:00:00.000Z"));
  state = applyEvidence(state, evidence(40), new Date("2026-01-06T10:00:00.000Z"));

  // alpha=0.35: 0.35*40 + 0.65*80 = 66, not the plain average of 60.
  assert.equal(state.masteryScore, 66);
});

test("applyEvidence caps recentScores to the configured rolling window", () => {
  let state = defaultConceptMasteryState("algebra");
  for (let i = 0; i < 10; i++) {
    state = applyEvidence(state, evidence(50 + i), new Date(`2026-01-0${(i % 9) + 1}T10:00:00.000Z`));
  }
  assert.ok(state.recentScores.length <= 6);
  assert.equal(state.attemptsCount, 10); // lifetime count is not windowed
});

test("deriveStatus requires both a high score AND enough confidence to be MASTERED", () => {
  assert.equal(deriveStatus(90, 30), MASTERY_STATUS.DEVELOPING); // high score, low confidence
  assert.equal(deriveStatus(90, 70), MASTERY_STATUS.MASTERED);
  assert.equal(deriveStatus(40, 90), MASTERY_STATUS.WEAK);
  assert.equal(deriveStatus(65, 90), MASTERY_STATUS.DEVELOPING);
});

test("applyEvidence schedules a sooner reassessment for WEAK than for MASTERED", () => {
  const now = new Date("2026-01-05T10:00:00.000Z");
  let weakState = defaultConceptMasteryState("weak-topic");
  weakState = applyEvidence(weakState, evidence(20, { concept: "weak-topic" }), now);

  let masteredState = defaultConceptMasteryState("strong-topic");
  for (let i = 0; i < 5; i++) {
    masteredState = applyEvidence(masteredState, evidence(95, { concept: "strong-topic" }), now);
  }

  assert.ok(weakState.nextReassessmentAt < masteredState.nextReassessmentAt);
});
