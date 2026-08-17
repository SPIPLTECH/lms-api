const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveCategory } = require("../constants/eventCategoryMap.constants");
const { EVENT_TYPES, EVENT_CATEGORIES } = require("../constants/eventTypes.constants");

test("resolveCategory maps every known EventType to a category", () => {
  for (const eventType of Object.values(EVENT_TYPES)) {
    const category = resolveCategory(eventType);
    assert.ok(Object.values(EVENT_CATEGORIES).includes(category), `${eventType} -> ${category}`);
  }
});

test("resolveCategory maps VIDEO_PROGRESS to VIDEO", () => {
  assert.equal(resolveCategory(EVENT_TYPES.VIDEO_PROGRESS), EVENT_CATEGORIES.VIDEO);
});

test("resolveCategory maps QUIZ_SUBMITTED to QUIZ", () => {
  assert.equal(resolveCategory(EVENT_TYPES.QUIZ_SUBMITTED), EVENT_CATEGORIES.QUIZ);
});

test("resolveCategory throws for an unknown event type", () => {
  assert.throws(() => resolveCategory("NOT_A_REAL_EVENT_TYPE"), /Unknown event type/);
});
