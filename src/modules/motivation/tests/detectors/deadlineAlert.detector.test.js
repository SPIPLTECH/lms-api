const test = require("node:test");
const assert = require("node:assert/strict");

const { detect } = require("../../services/domain/detectors/deadlineAlert.detector");
const { makeContext } = require("../helpers/makeContext");

const NOW = new Date("2026-01-10T00:00:00.000Z");
const hoursFromNow = (h) => new Date(NOW.getTime() + h * 3600 * 1000);

test("deadlineAlert.detect ignores deadlines outside the lookahead window", () => {
  const context = makeContext({ now: NOW, pendingQuizzes: [{ id: "q1", title: "Quiz", courseId: "c1", dueDate: hoursFromNow(200) }] });
  assert.deepEqual(detect(context), []);
});

test("deadlineAlert.detect ignores already-passed due dates", () => {
  const context = makeContext({ now: NOW, pendingAssignments: [{ id: "a1", title: "A", courseId: "c1", dueDate: hoursFromNow(-2) }] });
  assert.deepEqual(detect(context), []);
});

test("deadlineAlert.detect marks HIGH priority inside the urgent window, MEDIUM otherwise", () => {
  const context = makeContext({
    now: NOW,
    pendingQuizzes: [{ id: "soon", title: "Soon", courseId: "c1", dueDate: hoursFromNow(6) }],
    pendingAssignments: [{ id: "later", title: "Later", courseId: "c1", dueDate: hoursFromNow(40) }],
  });

  const candidates = detect(context);
  const soon = candidates.find((c) => c.dedupeKey === "quiz:soon");
  const later = candidates.find((c) => c.dedupeKey === "assignment:later");
  assert.equal(soon.priority, "HIGH");
  assert.equal(later.priority, "MEDIUM");
});
