const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluateStreak } = require("../services/domain/streakEvaluator");

const NOW = new Date("2026-01-10T20:00:00.000Z"); // 20:00 UTC

test("evaluateStreak reports BROKEN with no existing streak and zero consecutive days", () => {
  const result = evaluateStreak({ consecutiveLearningDays: 0, preferredLearningHour: null, existingStreak: null, now: NOW });
  assert.equal(result.streakStatus, "BROKEN");
  assert.equal(result.justBroken, false); // nothing to break — there was no prior streak
});

test("evaluateStreak detects justBroken when a live streak drops to zero", () => {
  const existingStreak = { currentStreakDays: 5, longestStreakDays: 5, celebratedStreakMilestones: [], lastBrokenAt: null };
  const result = evaluateStreak({ consecutiveLearningDays: 0, preferredLearningHour: null, existingStreak, now: NOW });
  assert.equal(result.justBroken, true);
  assert.equal(result.streakStatus, "BROKEN");
  assert.equal(result.lastBrokenAt, NOW);
});

test("evaluateStreak reports ACTIVE when the student was already active today", () => {
  const existingStreak = {
    currentStreakDays: 3,
    longestStreakDays: 3,
    celebratedStreakMilestones: [],
    lastActiveDate: NOW,
  };
  const result = evaluateStreak({ consecutiveLearningDays: 4, preferredLearningHour: 9, existingStreak, now: NOW });
  assert.equal(result.streakStatus, "ACTIVE");
});

test("evaluateStreak reports AT_RISK once past the preferred hour + grace without activity today", () => {
  const yesterday = new Date("2026-01-09T10:00:00.000Z");
  const existingStreak = { currentStreakDays: 4, longestStreakDays: 4, celebratedStreakMilestones: [], lastActiveDate: yesterday };
  // preferredHour 9 + grace 4h = 13:00 UTC cutoff; NOW is 20:00 UTC.
  const result = evaluateStreak({ consecutiveLearningDays: 4, preferredLearningHour: 9, existingStreak, now: NOW });
  assert.equal(result.streakStatus, "AT_RISK");
});

test("evaluateStreak tracks longestStreakDays as a running max", () => {
  const existingStreak = { currentStreakDays: 10, longestStreakDays: 10, celebratedStreakMilestones: [] };
  const result = evaluateStreak({ consecutiveLearningDays: 3, preferredLearningHour: 9, existingStreak, now: NOW });
  assert.equal(result.longestStreakDays, 10);
});

test("evaluateStreak crosses a new celebration milestone exactly once", () => {
  const existingStreak = { currentStreakDays: 6, longestStreakDays: 6, celebratedStreakMilestones: [] };
  const first = evaluateStreak({ consecutiveLearningDays: 7, preferredLearningHour: 9, existingStreak, now: NOW });
  assert.deepEqual(first.newlyCrossedMilestones, [7]);
  assert.deepEqual(first.celebratedStreakMilestones, [7]);

  const second = evaluateStreak({
    consecutiveLearningDays: 8,
    preferredLearningHour: 9,
    existingStreak: { currentStreakDays: 7, longestStreakDays: 7, celebratedStreakMilestones: [7] },
    now: NOW,
  });
  assert.deepEqual(second.newlyCrossedMilestones, []);
});
