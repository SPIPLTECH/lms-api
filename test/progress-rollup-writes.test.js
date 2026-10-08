const test = require("node:test");
const assert = require("node:assert");

const { containerRowChanged } = require("../src/utils/progressRollup");

// The roll-up recomputes every container of a course on each call but only
// writes the rows whose stored values differ. Pure function — no database.

const at = (iso) => new Date(iso);

test("a container with no progress row yet is written", () => {
  assert.strictEqual(containerRowChanged(undefined, { completed: false, completedAt: null, visited: false, visitedAt: null }), true);
});

test("an identical row is skipped, including equal dates held as different objects", () => {
  const stored = { topicId: "t1", completed: true, completedAt: at("2026-10-01T10:00:00Z"), visited: true, visitedAt: at("2026-10-01T09:00:00Z"), qualified: false, qualifiedAt: null };
  const row = { completed: true, completedAt: at("2026-10-01T10:00:00Z"), visited: true, visitedAt: at("2026-10-01T09:00:00Z"), qualified: false, qualifiedAt: null };
  assert.strictEqual(containerRowChanged(stored, row), false);
});

test("a flag that flips is written", () => {
  const stored = { completed: false, completedAt: null, visited: true, visitedAt: at("2026-10-01T09:00:00Z") };
  assert.strictEqual(containerRowChanged(stored, { ...stored, completed: true, completedAt: at("2026-10-03T05:00:00Z") }), true);
});

test("a timestamp that moves is written", () => {
  const stored = { completed: false, completedAt: null, visited: true, visitedAt: at("2026-10-01T09:00:00Z") };
  assert.strictEqual(containerRowChanged(stored, { ...stored, visitedAt: at("2026-10-02T09:00:00Z") }), true);
});

test("a timestamp cleared to null is written", () => {
  const stored = { completed: true, completedAt: at("2026-10-01T10:00:00Z"), visited: true, visitedAt: null };
  assert.strictEqual(containerRowChanged(stored, { ...stored, completed: false, completedAt: null }), true);
});

test("qualification changes on topics and lessons are written", () => {
  const stored = { completed: false, completedAt: null, visited: false, visitedAt: null, qualified: false, qualifiedAt: null };
  assert.strictEqual(containerRowChanged(stored, { ...stored, qualified: true, qualifiedAt: at("2026-10-03T05:00:00Z") }), true);
});

test("a stored undefined and a computed null count as the same value", () => {
  const stored = { completed: false, visited: false };
  assert.strictEqual(containerRowChanged(stored, { completed: false, completedAt: null, visited: false, visitedAt: null }), false);
});
