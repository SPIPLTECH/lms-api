const test = require("node:test");
const assert = require("node:assert");

const { getNextOrder } = require("../src/modules/contents/contentOrder.util");
const quizService = require("../src/modules/quizzes/quiz.service");
const prisma = require("../src/config/database");

test("getNextOrder — considers both Content and Quiz for the same scope", async (t) => {
  const originalContentFindFirst = prisma.content.findFirst;
  const originalQuizFindFirst = prisma.quiz.findFirst;

  t.after(() => {
    prisma.content.findFirst = originalContentFindFirst;
    prisma.quiz.findFirst = originalQuizFindFirst;
  });

  await t.test("returns max(content, quiz) + 1", async () => {
    prisma.content.findFirst = async () => ({ order: 3 });
    prisma.quiz.findFirst = async () => ({ order: 5 });

    const next = await getNextOrder("courseId", "c1");

    assert.strictEqual(next, 6);
  });

  await t.test("treats a missing side as 0", async () => {
    prisma.content.findFirst = async () => null;
    prisma.quiz.findFirst = async () => ({ order: 2 });

    const next = await getNextOrder("moduleId", "m1");

    assert.strictEqual(next, 3);
  });

  await t.test("empty scope on both sides returns 1", async () => {
    prisma.content.findFirst = async () => null;
    prisma.quiz.findFirst = async () => null;

    const next = await getNextOrder("topicId", "t1");

    assert.strictEqual(next, 1);
  });
});

test("createQuiz — order computation and explicit override", async (t) => {
  const originalContentFindFirst = prisma.content.findFirst;
  const originalQuizFindFirst = prisma.quiz.findFirst;
  const originalQuizCreate = prisma.quiz.create;
  const originalQuizFindUnique = prisma.quiz.findUnique;
  const originalModuleFindUnique = prisma.module.findUnique;
  const originalLessonFindUnique = prisma.lesson.findUnique;
  const originalTopicFindUnique = prisma.topic.findUnique;
  const originalBatchFindUnique = prisma.batch.findUnique;
  const originalCourseFindUnique = prisma.course.findUnique;

  t.after(() => {
    prisma.content.findFirst = originalContentFindFirst;
    prisma.quiz.findFirst = originalQuizFindFirst;
    prisma.quiz.create = originalQuizCreate;
    prisma.quiz.findUnique = originalQuizFindUnique;
    prisma.module.findUnique = originalModuleFindUnique;
    prisma.lesson.findUnique = originalLessonFindUnique;
    prisma.topic.findUnique = originalTopicFindUnique;
    prisma.batch.findUnique = originalBatchFindUnique;
    prisma.course.findUnique = originalCourseFindUnique;
  });

  await t.test("computes order for the most-specific parent (topic beats course)", async () => {
    prisma.content.findFirst = async () => null;
    prisma.quiz.findFirst = async () => ({ order: 7 });
    let capturedData;
    prisma.quiz.create = async ({ data }) => {
      capturedData = data;
      return { ...data, id: "new-quiz-id" };
    };
    prisma.quiz.findUnique = async () => ({ id: "new-quiz-id", quizQuestions: [] });
    prisma.topic.findUnique = async () => ({
      lessonId: "l1",
      lesson: { module: { id: "m1", courseId: "c1" } },
    });
    prisma.course.findUnique = async () => ({ title: "Some Course" });

    await quizService.createQuiz({
      title: "Topic Quiz", passingScore: 70, courseId: "c1", topicId: "t1",
    });

    assert.strictEqual(capturedData.order, 8);
  });

  await t.test("an explicit order is used verbatim when it doesn't collide", async () => {
    // Collision-check calls pass a concrete numeric `order` in `where`;
    // getNextOrder's max-lookup calls don't (no `order` key, or an
    // `{ not: null }` filter object) — branch on that to answer each caller
    // correctly with a single mock.
    prisma.content.findFirst = async ({ where }) =>
      typeof where.order === "number" ? null : { order: 99 };
    prisma.quiz.findFirst = async ({ where }) =>
      typeof where.order === "number" ? null : { order: 99 };
    let capturedData;
    prisma.quiz.create = async ({ data }) => {
      capturedData = data;
      return { ...data, id: "new-quiz-id" };
    };
    prisma.quiz.findUnique = async () => ({ id: "new-quiz-id", quizQuestions: [] });
    prisma.course.findUnique = async () => ({ title: "Some Course" });

    await quizService.createQuiz({
      title: "Positioned Quiz", passingScore: 70, courseId: "c1", order: 2,
    });

    assert.strictEqual(capturedData.order, 2);
  });

  await t.test("an explicit order that collides falls back to auto-computed, not a 500", async () => {
    // Simulates a scope that already holds a quiz at order 1 (e.g. the
    // Add Content picker's insertion order, computed from Content rows
    // only, landing on a slot a sibling quiz already occupies).
    prisma.content.findFirst = async ({ where }) =>
      typeof where.order === "number" ? null : null;
    prisma.quiz.findFirst = async ({ where }) =>
      typeof where.order === "number" ? { id: "existing-quiz" } : { order: 1 };
    let capturedData;
    prisma.quiz.create = async ({ data }) => {
      capturedData = data;
      return { ...data, id: "new-quiz-id" };
    };
    prisma.quiz.findUnique = async () => ({ id: "new-quiz-id", quizQuestions: [] });
    prisma.course.findUnique = async () => ({ title: "Some Course" });

    await quizService.createQuiz({
      title: "Colliding Quiz", passingScore: 70, courseId: "c1", order: 1,
    });

    assert.notStrictEqual(capturedData.order, 1);
    assert.strictEqual(capturedData.order, 2);
  });
});

test("reorderQuizzes — two-phase batch update avoids swap collisions", async (t) => {
  const originalQuizUpdate = prisma.quiz.update;
  const originalTransaction = prisma.$transaction;

  t.after(() => {
    prisma.quiz.update = originalQuizUpdate;
    prisma.$transaction = originalTransaction;
  });

  await t.test("issues 4 updates (2 offset placeholders, 2 final) inside one transaction", async () => {
    const calls = [];
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

test("getNextOrder — ignores quizzes with a NULL order", async (t) => {
  const originalContentFindFirst = prisma.content.findFirst;
  const originalQuizFindFirst = prisma.quiz.findFirst;

  t.after(() => {
    prisma.content.findFirst = originalContentFindFirst;
    prisma.quiz.findFirst = originalQuizFindFirst;
  });

  await t.test("quiz.findFirst is called with order: { not: null } so a NULL-order row can't win DESC ordering", async () => {
    let capturedWhere;
    prisma.content.findFirst = async () => null;
    prisma.quiz.findFirst = async ({ where }) => {
      capturedWhere = where;
      return { order: 4 };
    };

    const next = await getNextOrder("lessonId", "l1");

    assert.deepStrictEqual(capturedWhere, { lessonId: "l1", order: { not: null } });
    assert.strictEqual(next, 5);
  });
});
