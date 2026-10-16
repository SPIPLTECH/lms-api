const test = require("node:test");
const assert = require("node:assert");

const assignmentService = require("../src/modules/assignments/assignment.service");
const prisma = require("../src/config/database");
const { createSequenceDb } = require("./sequence-db.fake");

// Assignment ordering. An Assignment no longer has its own counter or number
// band: it is appended to its parent's ONE common sequence, shared with that
// parent's Content, Quizzes and child entity (see test/common-order.test.js).
// Every test here uses the in-memory database or stubs — nothing reaches the
// real database.

test("createAssignment — order is always server-computed, after the parent's last item of any type", async (t) => {
  const db = createSequenceDb();
  const originalTransaction = prisma.$transaction;
  prisma.$transaction = db.$transaction;
  t.after(() => {
    prisma.$transaction = originalTransaction;
  });

  await db.content.create({ data: { title: "Content-1", moduleId: "m1", order: 1 } });
  await db.quiz.create({ data: { title: "Quiz-1", courseId: "c1", moduleId: "m1", order: 2 } });
  await db.lesson.create({ data: { title: "Lesson-1", moduleId: "m1", order: 3 } });

  // A client-supplied order is ignored for Assignments — they always append.
  await assignmentService.createAssignment({
    title: "Lab Report",
    dueDate: "2026-10-01T00:00:00.000Z",
    moduleId: "m1",
    order: 1,
  });

  assert.deepStrictEqual(db.sequenceOf("moduleId", "m1"), [
    "content:Content-1@1",
    "quiz:Quiz-1@2",
    "lesson:Lesson-1@3",
    "assignment:Lab Report@4",
  ]);
});

test("createAssignment — still requires exactly one parent", async () => {
  await assert.rejects(
    assignmentService.createAssignment({ title: "Essay", dueDate: "2026-10-01T00:00:00.000Z", courseId: "c1", moduleId: "m1" }),
    /exactly one/
  );
});

test("reorderAssignments — two-phase batch update avoids swap collisions", async (t) => {
  const originalAssignmentUpdate = prisma.assignment.update;
  const originalAssignmentFindMany = prisma.assignment.findMany;
  const originalTransaction = prisma.$transaction;

  t.after(() => {
    prisma.assignment.update = originalAssignmentUpdate;
    prisma.assignment.findMany = originalAssignmentFindMany;
    prisma.$transaction = originalTransaction;
  });

  await t.test("issues 4 updates (2 offset placeholders, 2 final) inside one transaction", async () => {
    const calls = [];
    // Same Course-level guard as reorderQuizzes: these two assignments are
    // Lesson-level, so nothing about this reorder changes.
    prisma.assignment.findMany = async () => [
      { id: "a", courseId: "c1", moduleId: "m1", lessonId: "l1", topicId: null, subTopicId: null, conceptId: null },
      { id: "b", courseId: "c1", moduleId: "m1", lessonId: "l1", topicId: null, subTopicId: null, conceptId: null },
    ];
    prisma.assignment.update = async ({ where, data }) => {
      calls.push({ where, data });
      return { id: where.id, ...data };
    };

    let capturedTransactionArg;
    prisma.$transaction = async (arg) => {
      capturedTransactionArg = arg;
      return Promise.all(arg);
    };

    await assignmentService.reorderAssignments([
      { id: "a", order: 5 },
      { id: "b", order: 3 },
    ]);

    assert.ok(Array.isArray(capturedTransactionArg));
    assert.strictEqual(calls.length, 4);
    assert.ok(calls[0].data.order < 0);
    assert.ok(calls[1].data.order < 0);
    assert.notStrictEqual(calls[0].data.order, calls[1].data.order);
    assert.deepStrictEqual(calls[2], { where: { id: "a" }, data: { order: 5 } });
    assert.deepStrictEqual(calls[3], { where: { id: "b" }, data: { order: 3 } });
  });
});
