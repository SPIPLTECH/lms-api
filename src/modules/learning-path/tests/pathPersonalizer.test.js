const test = require("node:test");
const assert = require("node:assert/strict");

const { personalizeSequence } = require("../services/domain/pathPersonalizer");

const makeSequenceItem = (overrides = {}) => ({
  lessonId: "l1",
  moduleId: "m1",
  title: "Variables",
  order: 1,
  completed: false,
  estimatedMinutes: 40,
  ...overrides,
});

test("personalizeSequence returns the sequence unchanged when there is no course state", () => {
  const sequence = [makeSequenceItem()];
  assert.deepEqual(personalizeSequence(sequence, null), sequence);
});

test("personalizeSequence returns the sequence unchanged when conceptMastery is empty", () => {
  const sequence = [makeSequenceItem()];
  assert.deepEqual(personalizeSequence(sequence, { conceptMastery: [] }), sequence);
});

test("personalizeSequence scales estimatedMinutes by the module's recommendedMinutes:originalMinutes ratio", () => {
  const sequence = [makeSequenceItem({ moduleId: "m1", estimatedMinutes: 40 })];
  const courseState = {
    conceptMastery: [{ moduleId: "m1", concept: "Variables", recommendedMode: "SMART_REVISION", originalMinutes: 60, recommendedMinutes: 12 }],
  };

  const [result] = personalizeSequence(sequence, courseState);

  // ratio = 12/60 = 0.2 -> 40 * 0.2 = 8
  assert.equal(result.recommendedMode, "SMART_REVISION");
  assert.equal(result.recommendedMinutes, 8);
  assert.match(result.aiPersonalizationReason, /Variables/);
});

test("personalizeSequence leaves lessons in modules without entry-assessment data untouched", () => {
  const sequence = [makeSequenceItem({ moduleId: "m-untested" })];
  const courseState = {
    conceptMastery: [{ moduleId: "m1", concept: "Variables", recommendedMode: "SMART_REVISION", originalMinutes: 60, recommendedMinutes: 12 }],
  };

  const [result] = personalizeSequence(sequence, courseState);
  assert.equal(result.recommendedMode, undefined);
  assert.equal(result.estimatedMinutes, 40);
});

test("personalizeSequence never produces a zero or negative recommended duration", () => {
  const sequence = [makeSequenceItem({ moduleId: "m1", estimatedMinutes: 1 })];
  const courseState = {
    conceptMastery: [{ moduleId: "m1", concept: "Variables", recommendedMode: "SMART_REVISION", originalMinutes: 60, recommendedMinutes: 5 }],
  };

  const [result] = personalizeSequence(sequence, courseState);
  assert.ok(result.recommendedMinutes >= 1);
});
