const test = require("node:test");
const assert = require("node:assert/strict");

const { personalizeConcept } = require("../services/domain/courseStatePersonalizer");

test("personalizeConcept assigns SMART_REVISION at/above the strong-mastery threshold, clamped to 5-15 minutes", () => {
  const { mode, recommendedMinutes } = personalizeConcept(85, 60);
  assert.equal(mode, "SMART_REVISION");
  assert.ok(recommendedMinutes >= 5 && recommendedMinutes <= 15);
});

test("personalizeConcept never compresses below the 5-minute floor even for a very short lesson", () => {
  const { recommendedMinutes } = personalizeConcept(100, 10);
  assert.ok(recommendedMinutes >= 5);
});

test("personalizeConcept never compresses above the 15-minute ceiling even for a very long lesson", () => {
  const { recommendedMinutes } = personalizeConcept(100, 300);
  assert.ok(recommendedMinutes <= 15);
});

test("personalizeConcept assigns DEEP_LEARNING below the weak-mastery threshold and expands duration", () => {
  const { mode, recommendedMinutes } = personalizeConcept(30, 40);
  assert.equal(mode, "DEEP_LEARNING");
  assert.ok(recommendedMinutes > 40);
});

test("personalizeConcept assigns STANDARD_LEARNING in between and leaves duration unchanged", () => {
  const { mode, recommendedMinutes } = personalizeConcept(65, 40);
  assert.equal(mode, "STANDARD_LEARNING");
  assert.equal(recommendedMinutes, 40);
});

test("personalizeConcept never skips a concept — every mode returns a positive duration", () => {
  for (const mastery of [0, 25, 50, 65, 80, 100]) {
    const { recommendedMinutes } = personalizeConcept(mastery, 45);
    assert.ok(recommendedMinutes > 0);
  }
});
