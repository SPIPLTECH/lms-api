const test = require("node:test");
const assert = require("node:assert/strict");

const {
  reduceRisk,
  refreshRiskForInactivity,
  computeInactivity,
  computeDeadlineRisk,
  dropoutRiskLevelFor,
} = require("../services/reducers/risk.reducer");
const { defaultRiskState, defaultProgressState, defaultEngagementState, defaultPerformanceState } = require("../constants/defaultDomainState.constants");
const { EVENT_TYPES } = require("../constants");
const { makeEvent } = require("./helpers/makeEvent");

test("computeInactivity is 0 below the medium threshold and ramps toward 100 at the high threshold", () => {
  const now = new Date("2026-01-15T00:00:00.000Z");
  assert.equal(computeInactivity(new Date("2026-01-12T00:00:00.000Z"), now).inactivityScore, 0); // 3 days, under 7-day medium
  const high = computeInactivity(new Date("2026-01-01T00:00:00.000Z"), now); // 14 days = high threshold
  assert.equal(high.inactivityScore, 100);
});

test("computeDeadlineRisk is 0 with no pending assignment and climbs with days pending", () => {
  const now = new Date("2026-01-15T00:00:00.000Z");
  assert.equal(computeDeadlineRisk(null, now), 0);
  assert.equal(computeDeadlineRisk(new Date("2026-01-14T00:00:00.000Z"), now), 0); // 1 day, within grace
  const risk = computeDeadlineRisk(new Date("2026-01-05T00:00:00.000Z"), now); // 10 days pending
  assert.equal(risk, 100);
});

test("dropoutRiskLevelFor buckets into LOW/MEDIUM/HIGH", () => {
  assert.equal(dropoutRiskLevelFor(10), "LOW");
  assert.equal(dropoutRiskLevelFor(40), "MEDIUM");
  assert.equal(dropoutRiskLevelFor(80), "HIGH");
});

test("reduceRisk clears deadline risk once the assignment is submitted", () => {
  const context = { progress: defaultProgressState(), engagement: defaultEngagementState(), performance: defaultPerformanceState() };

  let risk = reduceRisk(defaultRiskState(), makeEvent({ eventType: EVENT_TYPES.ASSIGNMENT_STARTED, createdAt: new Date("2026-01-01T00:00:00.000Z") }), context);
  assert.ok(risk.pendingAssignmentStartedAt);

  risk = reduceRisk(risk, makeEvent({ eventType: EVENT_TYPES.ASSIGNMENT_SUBMITTED, createdAt: new Date("2026-01-02T00:00:00.000Z") }), context);
  assert.equal(risk.pendingAssignmentStartedAt, null);
  assert.equal(risk.deadlineRiskScore, 0);
});

test("reduceRisk always reports 0 inactivity — a live event means the student is active right now", () => {
  const context = { progress: defaultProgressState(), engagement: defaultEngagementState(), performance: defaultPerformanceState() };
  const risk = reduceRisk(defaultRiskState(), makeEvent(), context);

  assert.equal(risk.inactivityDays, 0);
  assert.equal(risk.inactivityScore, 0);
});

test("refreshRiskForInactivity computes real inactivity days from engagement.lastActiveAt without any new event", () => {
  const engagement = { ...defaultEngagementState(), lastActiveAt: new Date("2026-01-01T00:00:00.000Z") };
  const context = { progress: defaultProgressState(), engagement, performance: defaultPerformanceState() };

  const risk = refreshRiskForInactivity(defaultRiskState(), context, new Date("2026-01-16T00:00:00.000Z"));

  assert.equal(risk.inactivityDays, 15);
  assert.ok(risk.inactivityScore > 0);
  assert.equal(risk.dropoutRiskLevel, "HIGH");
});
