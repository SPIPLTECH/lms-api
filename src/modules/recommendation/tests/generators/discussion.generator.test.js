const test = require("node:test");
const assert = require("node:assert/strict");

const { generate } = require("../../services/domain/generators/discussion.generator");
const { makeContext } = require("../helpers/makeContext");

const NOW = new Date("2026-01-10T00:00:00.000Z");
const daysAgo = (d) => new Date(NOW.getTime() - d * 24 * 3600 * 1000);

test("discussion.generate stays silent when there's no recent course activity", () => {
  assert.deepEqual(generate(makeContext({ now: NOW, recentEvents: [] })), []);
});

test("discussion.generate nudges a course with recent engagement but no discussion activity", () => {
  const context = makeContext({
    now: NOW,
    recentEvents: [
      { courseId: "c1", eventType: "LESSON_COMPLETED", createdAt: daysAgo(1) },
      { courseId: "c1", eventType: "QUIZ_COMPLETED", createdAt: daysAgo(2) },
    ],
  });

  const candidates = generate(context);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].type, "JOIN_DISCUSSION");
  assert.equal(candidates[0].courseId, "c1");
});

test("discussion.generate stays silent for a course where the student already discusses", () => {
  const context = makeContext({
    now: NOW,
    recentEvents: [
      { courseId: "c1", eventType: "LESSON_COMPLETED", createdAt: daysAgo(1) },
      { courseId: "c1", eventType: "DISCUSSION_POST_CREATED", createdAt: daysAgo(1) },
    ],
  });
  assert.deepEqual(generate(context), []);
});

test("discussion.generate ignores events outside the lookback window", () => {
  const context = makeContext({
    now: NOW,
    recentEvents: [{ courseId: "c1", eventType: "LESSON_COMPLETED", createdAt: daysAgo(30) }],
  });
  assert.deepEqual(generate(context), []);
});
