const test = require("node:test");
const assert = require("node:assert/strict");

const { generate } = require("../../services/domain/generators/studyTasks.generator");
const { makeContext } = require("../helpers/makeContext");
const { DAILY_TASKS_MAX_ITEMS } = require("../../constants");

test("studyTasks.generate returns nothing when there are no prior candidates", () => {
  assert.deepEqual(generate(makeContext(), []), []);
});

test("studyTasks.generate bundles the top-urgency prior candidates, capped at DAILY_TASKS_MAX_ITEMS", () => {
  const prior = Array.from({ length: DAILY_TASKS_MAX_ITEMS + 5 }, (_, i) => ({
    type: "REVIEW_WEAK_TOPICS",
    dedupeKey: `c${i}`,
    reason: "r",
    urgency: i,
    impact: 50,
    confidence: 50,
    estimatedTimeMinutes: 10,
  }));

  const [bundle] = generate(makeContext(), prior);
  assert.equal(bundle.type, "DAILY_LEARNING_TASKS");
  assert.equal(bundle.metadata.tasks.length, DAILY_TASKS_MAX_ITEMS);
  // highest-urgency entries (the last ones, i = length-1 downward) should be the ones bundled
  const bundledKeys = bundle.metadata.tasks.map((t) => t.dedupeKey);
  assert.ok(bundledKeys.includes(`c${prior.length - 1}`));
});

test("studyTasks.generate sums estimated time across the bundled tasks", () => {
  const prior = [
    { type: "A", dedupeKey: "a", reason: "r", urgency: 90, impact: 50, confidence: 50, estimatedTimeMinutes: 10 },
    { type: "B", dedupeKey: "b", reason: "r", urgency: 80, impact: 50, confidence: 50, estimatedTimeMinutes: 20 },
  ];
  const [bundle] = generate(makeContext(), prior);
  assert.equal(bundle.estimatedTimeMinutes, 30);
});
