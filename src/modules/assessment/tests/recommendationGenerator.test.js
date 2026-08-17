const test = require("node:test");
const assert = require("node:assert/strict");

const { generateRecommendations } = require("../services/domain/recommendationGenerator");
const { MASTERY_STATUS, ASSESSMENT_TYPE } = require("../constants");

const mastery = (concept, status, overrides = {}) => ({
  concept,
  status,
  lastCourseId: "course_1",
  nextReassessmentAt: null,
  ...overrides,
});

test("generateRecommendations groups weak concepts into one REVISION recommendation", () => {
  const states = [mastery("a", MASTERY_STATUS.WEAK), mastery("b", MASTERY_STATUS.WEAK)];
  const recs = generateRecommendations(states, new Date());

  assert.equal(recs.length, 1);
  assert.equal(recs[0].type, ASSESSMENT_TYPE.REVISION);
  assert.deepEqual(recs[0].targetConcepts.sort(), ["a", "b"]);
});

test("generateRecommendations groups developing concepts into one ADAPTIVE recommendation", () => {
  const states = [mastery("c", MASTERY_STATUS.DEVELOPING)];
  const recs = generateRecommendations(states, new Date());

  assert.equal(recs.length, 1);
  assert.equal(recs[0].type, ASSESSMENT_TYPE.ADAPTIVE);
});

test("generateRecommendations surfaces mastered concepts only once their reassessment is due", () => {
  const now = new Date("2026-01-10T00:00:00.000Z");
  const notDue = mastery("d", MASTERY_STATUS.MASTERED, { nextReassessmentAt: new Date("2026-02-01T00:00:00.000Z") });
  const due = mastery("e", MASTERY_STATUS.MASTERED, { nextReassessmentAt: new Date("2026-01-01T00:00:00.000Z") });

  const recs = generateRecommendations([notDue, due], now);

  assert.equal(recs.length, 1);
  assert.deepEqual(recs[0].targetConcepts, ["e"]);
});

test("generateRecommendations returns nothing for an all-mastered, none-due student", () => {
  const notDue = mastery("f", MASTERY_STATUS.MASTERED, { nextReassessmentAt: new Date("2027-01-01T00:00:00.000Z") });
  assert.deepEqual(generateRecommendations([notDue], new Date("2026-01-01T00:00:00.000Z")), []);
});
