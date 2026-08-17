const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSequence, findNextItem, remainingItems, estimateLessonMinutes } = require("../services/domain/sequencer");

const courseStructure = [
  {
    id: "m1",
    lessons: [
      { id: "l1", title: "Intro", topics: [{ contents: [{ duration: 600 }] }] }, // 10 min
      { id: "l2", title: "Basics", topics: [{ contents: [] }] }, // default
    ],
  },
  {
    id: "m2",
    lessons: [{ id: "l3", title: "Advanced", topics: [{ contents: [{ duration: 300 }, { duration: 300 }] }] }], // 10 min
  },
];

test("buildSequence walks Module.order -> Lesson.order and marks completion from Progress", () => {
  const progress = new Map([["l1", { completed: true }]]);
  const sequence = buildSequence(courseStructure, progress);
  assert.equal(sequence.length, 3);
  assert.deepEqual(
    sequence.map((s) => s.lessonId),
    ["l1", "l2", "l3"]
  );
  assert.equal(sequence[0].completed, true);
  assert.equal(sequence[1].completed, false);
  assert.equal(sequence[0].order, 1);
  assert.equal(sequence[2].order, 3);
});

test("estimateLessonMinutes sums real Content.duration (via Topic), falls back to the default when none exists", () => {
  assert.equal(estimateLessonMinutes({ topics: [{ contents: [{ duration: 600 }] }] }), 10);
  assert.equal(estimateLessonMinutes({ topics: [{ contents: [{ duration: 300 }] }, { contents: [{ duration: 300 }] }] }), 10);
  assert.equal(estimateLessonMinutes({ topics: [{ contents: [] }] }), 20);
  assert.equal(estimateLessonMinutes({ topics: [] }), 20);
  assert.equal(estimateLessonMinutes({ topics: null }), 20);
});

test("findNextItem returns the first incomplete lesson in sequence order", () => {
  const progress = new Map([["l1", { completed: true }]]);
  const sequence = buildSequence(courseStructure, progress);
  assert.equal(findNextItem(sequence).lessonId, "l2");
});

test("findNextItem returns null when every lesson is complete", () => {
  const progress = new Map([
    ["l1", { completed: true }],
    ["l2", { completed: true }],
    ["l3", { completed: true }],
  ]);
  const sequence = buildSequence(courseStructure, progress);
  assert.equal(findNextItem(sequence), null);
});

test("remainingItems excludes completed lessons, preserving order", () => {
  const progress = new Map([["l1", { completed: true }]]);
  const sequence = buildSequence(courseStructure, progress);
  assert.deepEqual(
    remainingItems(sequence).map((s) => s.lessonId),
    ["l2", "l3"]
  );
});
