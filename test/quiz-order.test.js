const test = require("node:test");
const assert = require("node:assert");

const orderUtil = require("../src/modules/contents/contentOrder.util");
const quizService = require("../src/modules/quizzes/quiz.service");
const prisma = require("../src/config/database");

// Quiz ordering. A Quiz no longer has its own counter or number band: it takes
// its place in its most specific parent's ONE common sequence, shared with
// that parent's Content, Assignments and child entity. The end-to-end
// sequence behaviour (append, insert, remove, every level) is covered in
// test/common-order.test.js; this file keeps the Quiz-specific contracts.
// Every test here uses stub clients only — nothing reaches the database.

test("no Quiz/Assignment number bands remain", () => {
  assert.strictEqual(orderUtil.QUIZ_ORDER_BASE, undefined);
  assert.strictEqual(orderUtil.ASSIGNMENT_ORDER_BASE, undefined);
  assert.strictEqual(orderUtil.getNextQuizOrder, undefined);
  assert.strictEqual(orderUtil.getNextAssignmentOrder, undefined);
});

test("getNextOrder — one past the parent's last item of ANY type", async () => {
  const lastByKind = {
    content: { _max: { order: 2 } },
    quiz: { _max: { order: 5 } },
    assignment: { _max: { order: null } },
    topic: { _max: { order: 4 } },
  };
  const client = Object.fromEntries(
    Object.entries(lastByKind).map(([kind, result]) => [kind, { aggregate: async () => result }])
  );

  assert.strictEqual(await orderUtil.getNextOrder("lessonId", "l1", client), 6);
});

test("getNextOrder — an empty parent starts the sequence at 1", async () => {
  const empty = { aggregate: async () => ({ _max: { order: null } }) };
  const client = { content: empty, quiz: empty, assignment: empty, concept: empty };

  assert.strictEqual(await orderUtil.getNextOrder("subTopicId", "s1", client), 1);
});

test("mostSpecificParentField — a quiz carrying ancestor ids belongs to its deepest parent", () => {
  assert.strictEqual(
    orderUtil.mostSpecificParentField({ courseId: "c", moduleId: "m", lessonId: "l", topicId: "t", subTopicId: "s" }),
    "subTopicId"
  );
  assert.strictEqual(orderUtil.mostSpecificParentField({ courseId: "c" }), "courseId");
});

test("reorderQuizzes — two-phase batch update avoids swap collisions", async (t) => {
  const originalQuizUpdate = prisma.quiz.update;
  const originalQuizFindMany = prisma.quiz.findMany;
  const originalTransaction = prisma.$transaction;

  t.after(() => {
    prisma.quiz.update = originalQuizUpdate;
    prisma.quiz.findMany = originalQuizFindMany;
    prisma.$transaction = originalTransaction;
  });

  await t.test("issues 4 updates (2 offset placeholders, 2 final) inside one transaction", async () => {
    const calls = [];
    // reorderQuizzes now reads the rows first, to apply the Course-level rule
    // (quizzes last) when they are Course-direct. These two are Module-level,
    // so the guard passes them straight through and the two-phase write below
    // is exactly what it was.
    prisma.quiz.findMany = async () => [
      { id: "a", courseId: "c1", moduleId: "m1", lessonId: null, topicId: null, subTopicId: null, conceptId: null },
      { id: "b", courseId: "c1", moduleId: "m1", lessonId: null, topicId: null, subTopicId: null, conceptId: null },
    ];
    prisma.quiz.update = async ({ where, data }) => {
      calls.push({ where, data });
      return { id: where.id, ...data };
    };

    let capturedTransactionArg;
    prisma.$transaction = async (arg) => {
      capturedTransactionArg = arg;
      return Promise.all(arg);
    };

    await quizService.reorderQuizzes([
      { id: "a", order: 5 },
      { id: "b", order: 3 },
    ]);

    assert.ok(Array.isArray(capturedTransactionArg), "prisma.$transaction must be called with an array");
    assert.strictEqual(calls.length, 4);

    // First 2 calls are disjoint negative placeholders (the offset phase).
    assert.strictEqual(calls[0].where.id, "a");
    assert.ok(calls[0].data.order < 0);
    assert.strictEqual(calls[1].where.id, "b");
    assert.ok(calls[1].data.order < 0);
    assert.notStrictEqual(calls[0].data.order, calls[1].data.order);

    // Last 2 calls land each quiz on its real target order.
    assert.deepStrictEqual(calls[2], { where: { id: "a" }, data: { order: 5 } });
    assert.deepStrictEqual(calls[3], { where: { id: "b" }, data: { order: 3 } });
  });
});
