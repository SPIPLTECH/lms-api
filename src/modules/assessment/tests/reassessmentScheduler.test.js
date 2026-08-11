const test = require("node:test");
const assert = require("node:assert/strict");

const { scheduleNextReassessment } = require("../services/domain/reassessmentScheduler");
const { MASTERY_STATUS, REASSESSMENT_INTERVAL_DAYS, RISK_ESCALATION_INTERVAL_FACTOR } = require("../constants");

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date("2026-01-01T00:00:00.000Z");

test("scheduleNextReassessment returns null for UNASSESSED — no evidence, nothing to schedule", () => {
  assert.equal(scheduleNextReassessment(MASTERY_STATUS.UNASSESSED, now), null);
});

test("scheduleNextReassessment spaces WEAK sooner than DEVELOPING sooner than MASTERED", () => {
  const weak = scheduleNextReassessment(MASTERY_STATUS.WEAK, now);
  const developing = scheduleNextReassessment(MASTERY_STATUS.DEVELOPING, now);
  const mastered = scheduleNextReassessment(MASTERY_STATUS.MASTERED, now);

  assert.ok(weak < developing);
  assert.ok(developing < mastered);
});

test("scheduleNextReassessment matches the configured interval exactly", () => {
  const result = scheduleNextReassessment(MASTERY_STATUS.WEAK, now);
  const expectedDays = REASSESSMENT_INTERVAL_DAYS.WEAK;
  assert.equal(result.getTime(), now.getTime() + expectedDays * DAY_MS);
});

test("scheduleNextReassessment escalates (moves sooner) for non-mastered concepts under risk escalation", () => {
  const normal = scheduleNextReassessment(MASTERY_STATUS.DEVELOPING, now, false);
  const escalated = scheduleNextReassessment(MASTERY_STATUS.DEVELOPING, now, true);

  assert.ok(escalated < normal);
  const expectedDays = REASSESSMENT_INTERVAL_DAYS.DEVELOPING * RISK_ESCALATION_INTERVAL_FACTOR;
  assert.equal(escalated.getTime(), now.getTime() + expectedDays * DAY_MS);
});

test("scheduleNextReassessment does NOT escalate an already-mastered concept sooner", () => {
  const normal = scheduleNextReassessment(MASTERY_STATUS.MASTERED, now, false);
  const escalated = scheduleNextReassessment(MASTERY_STATUS.MASTERED, now, true);
  assert.equal(normal.getTime(), escalated.getTime());
});
