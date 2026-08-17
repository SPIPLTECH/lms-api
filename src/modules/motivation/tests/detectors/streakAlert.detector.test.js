const test = require("node:test");
const assert = require("node:assert/strict");

const { detect } = require("../../services/domain/detectors/streakAlert.detector");
const { makeContext } = require("../helpers/makeContext");

const context = makeContext();

test("streakAlert.detect fires when the streak just broke", () => {
  const [candidate] = detect(context, { justBroken: true, streakStatus: "BROKEN", longestStreakDays: 12 });
  assert.equal(candidate.type, "LEARNING_STREAK_ALERT");
  assert.equal(candidate.dedupeKey, "broken");
});

test("streakAlert.detect fires HIGH priority when the streak is at risk today", () => {
  const [candidate] = detect(context, { justBroken: false, streakStatus: "AT_RISK", currentStreakDays: 5 });
  assert.equal(candidate.dedupeKey, "at-risk");
  assert.equal(candidate.priority, "HIGH");
});

test("streakAlert.detect stays silent for a healthy, active streak", () => {
  assert.deepEqual(detect(context, { justBroken: false, streakStatus: "ACTIVE", currentStreakDays: 5 }), []);
});
