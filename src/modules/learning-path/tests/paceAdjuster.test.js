const test = require("node:test");
const assert = require("node:assert/strict");

const { determinePace } = require("../services/domain/paceAdjuster");

test("determinePace eases up on a low pass rate regardless of speed", () => {
  const result = determinePace({ preferredLearningSpeed: "FAST", passRate: 30, improvementTrend: "IMPROVING", baseDailyMinutes: 30 });
  assert.equal(result.difficultyAdjustment, "EASE_UP");
  assert.ok(result.suggestedStudyMinutesPerDay < 30);
});

test("determinePace eases up on SLOW speed even with a decent pass rate", () => {
  const result = determinePace({ preferredLearningSpeed: "SLOW", passRate: 70, improvementTrend: "STABLE", baseDailyMinutes: 30 });
  assert.equal(result.difficultyAdjustment, "EASE_UP");
});

test("determinePace accelerates only when pass rate is high, speed is FAST, and trend is IMPROVING", () => {
  const result = determinePace({ preferredLearningSpeed: "FAST", passRate: 90, improvementTrend: "IMPROVING", baseDailyMinutes: 30 });
  assert.equal(result.difficultyAdjustment, "ACCELERATE");
  assert.ok(result.suggestedStudyMinutesPerDay > 30);
});

test("determinePace stays STANDARD for an unremarkable middle case", () => {
  const result = determinePace({ preferredLearningSpeed: "NORMAL", passRate: 65, improvementTrend: "STABLE", baseDailyMinutes: 30 });
  assert.equal(result.difficultyAdjustment, "STANDARD");
  assert.equal(result.suggestedStudyMinutesPerDay, 30);
});

test("determinePace never suggests fewer than the minimum daily minutes", () => {
  const result = determinePace({ preferredLearningSpeed: "SLOW", passRate: 0, improvementTrend: "STABLE", baseDailyMinutes: 5 });
  assert.ok(result.suggestedStudyMinutesPerDay >= 10);
});

test("determinePace falls back to the default daily minutes when none is known", () => {
  const result = determinePace({ preferredLearningSpeed: "NORMAL", passRate: 65, improvementTrend: "STABLE", baseDailyMinutes: 0 });
  assert.equal(result.suggestedStudyMinutesPerDay, 30);
});
