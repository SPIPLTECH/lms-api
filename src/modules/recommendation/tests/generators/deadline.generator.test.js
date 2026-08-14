const test = require("node:test");
const assert = require("node:assert/strict");

const { generate } = require("../../services/domain/generators/deadline.generator");
const { makeContext } = require("../helpers/makeContext");

const NOW = new Date("2026-01-10T00:00:00.000Z");
const hoursFromNow = (h) => new Date(NOW.getTime() + h * 3600 * 1000);

test("deadline.generate ignores quizzes/assignments outside the lookahead window", () => {
  const context = makeContext({
    now: NOW,
    pendingQuizzes: [{ id: "q1", title: "Quiz", courseId: "c1", dueDate: hoursFromNow(200) }],
    pendingAssignments: [{ id: "a1", title: "Assignment", courseId: "c1", dueDate: hoursFromNow(200) }],
  });
  assert.deepEqual(generate(context), []);
});

test("deadline.generate ignores already-passed due dates", () => {
  const context = makeContext({ now: NOW, pendingQuizzes: [{ id: "q1", title: "Quiz", courseId: "c1", dueDate: hoursFromNow(-5) }] });
  assert.deepEqual(generate(context), []);
});

test("deadline.generate surfaces quizzes and assignments due within the lookahead window", () => {
  const context = makeContext({
    now: NOW,
    pendingQuizzes: [{ id: "q1", title: "Quiz", courseId: "c1", dueDate: hoursFromNow(10), timeLimit: 30 }],
    pendingAssignments: [{ id: "a1", title: "Assignment", courseId: "c1", dueDate: hoursFromNow(50), estimatedTime: 40 }],
  });

  const candidates = generate(context);
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((c) => c.type === "REVISE_BEFORE_DEADLINE"));
});

test("deadline.generate gives higher urgency to the closer deadline", () => {
  const context = makeContext({
    now: NOW,
    pendingQuizzes: [
      { id: "soon", title: "Soon", courseId: "c1", dueDate: hoursFromNow(5) },
      { id: "later", title: "Later", courseId: "c1", dueDate: hoursFromNow(60) },
    ],
  });

  const candidates = generate(context);
  const soon = candidates.find((c) => c.dedupeKey === "quiz:soon");
  const later = candidates.find((c) => c.dedupeKey === "quiz:later");
  assert.ok(soon.urgency > later.urgency);
});
