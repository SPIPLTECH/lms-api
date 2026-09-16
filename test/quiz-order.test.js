const test = require("node:test");
const assert = require("node:assert");

const {
  getNextOrder,
  getNextQuizOrder,
  getNextAssignmentOrder,
  QUIZ_ORDER_BASE,
  ASSIGNMENT_ORDER_BASE,
} = require("../src/modules/contents/contentOrder.util");
const quizService = require("../src/modules/quizzes/quiz.service");
const prisma = require("../src/config/database");

test("order zone constants", () => {
  assert.ok(QUIZ_ORDER_BASE > 0);
  assert.ok(ASSIGNMENT_ORDER_BASE > QUIZ_ORDER_BASE);
});

test("getNextOrder — Content-only, ignores Quiz entirely", async (t) => {
  const originalContentFindFirst = prisma.content.findFirst;
  const originalQuizFindFirst = prisma.quiz.findFirst;

  t.after(() => {
    prisma.content.findFirst = originalContentFindFirst;
    prisma.quiz.findFirst = originalQuizFindFirst;
  });

  await t.test("returns content max + 1, never consults Quiz", async () => {
    prisma.content.findFirst = async () => ({ order: 3 });
    prisma.quiz.findFirst = async () => {
      throw new Error("getNextOrder must not query Quiz anymore");
    };

    const next = await getNextOrder("courseId", "c1");

    assert.strictEqual(next, 4);
  });

  await t.test("empty scope returns 1", async () => {
    prisma.content.findFirst = async () => null;

    const next = await getNextOrder("topicId", "t1");

    assert.strictEqual(next, 1);
  });
});

test("getNextQuizOrder — Quiz-only, zone-banded", async (t) => {
  const originalQuizFindFirst = prisma.quiz.findFirst;

  t.after(() => {
    prisma.quiz.findFirst = originalQuizFindFirst;
  });

  await t.test("first quiz in an empty scope lands at QUIZ_ORDER_BASE + 1", async () => {
    prisma.quiz.findFirst = async () => null;

    const next = await getNextQuizOrder("lessonId", "l1");

    assert.strictEqual(next, QUIZ_ORDER_BASE + 1);
  });

  await t.test("subsequent quiz continues the banded sequence", async () => {
    prisma.quiz.findFirst = async ({ where }) => {
      assert.deepStrictEqual(where, { lessonId: "l1", order: { not: null } });
      return { order: QUIZ_ORDER_BASE + 2 };
    };

    const next = await getNextQuizOrder("lessonId", "l1");

    assert.strictEqual(next, QUIZ_ORDER_BASE + 3);
  });
});

test("getNextAssignmentOrder — Assignment-only, zone-banded", async (t) => {
  const originalAssignmentFindFirst = prisma.assignment.findFirst;

  t.after(() => {
    prisma.assignment.findFirst = originalAssignmentFindFirst;
  });

  await t.test("first assignment in an empty scope lands at ASSIGNMENT_ORDER_BASE + 1", async () => {
    prisma.assignment.findFirst = async () => null;

    const next = await getNextAssignmentOrder("moduleId", "m1");

    assert.strictEqual(next, ASSIGNMENT_ORDER_BASE + 1);
  });

  await t.test("subsequent assignment continues the banded sequence", async () => {
    prisma.assignment.findFirst = async ({ where }) => {
      assert.deepStrictEqual(where, { moduleId: "m1", order: { not: null } });
      return { order: ASSIGNMENT_ORDER_BASE + 5 };
    };

    const next = await getNextAssignmentOrder("moduleId", "m1");

    assert.strictEqual(next, ASSIGNMENT_ORDER_BASE + 6);
  });
});

test("createQuiz — order computation lands in the Quiz zone", async (t) => {
  const originalQuizFindFirst = prisma.quiz.findFirst;
  const originalQuizCreate = prisma.quiz.create;
  const originalQuizFindUnique = prisma.quiz.findUnique;
  const originalTopicFindUnique = prisma.topic.findUnique;
  const originalCourseFindUnique = prisma.course.findUnique;

  t.after(() => {
    prisma.quiz.findFirst = originalQuizFindFirst;
    prisma.quiz.create = originalQuizCreate;
    prisma.quiz.findUnique = originalQuizFindUnique;
    prisma.topic.findUnique = originalTopicFindUnique;
    prisma.course.findUnique = originalCourseFindUnique;
  });

  await t.test("auto-computed order for the most-specific parent (topic beats course)", async () => {
    prisma.quiz.findFirst = async () => ({ order: QUIZ_ORDER_BASE + 7 });
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

    assert.strictEqual(capturedData.order, QUIZ_ORDER_BASE + 8);
  });

  await t.test("an explicit small order is rebased into the Quiz zone", async () => {
    prisma.quiz.findFirst = async () => null;
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

    assert.strictEqual(capturedData.order, QUIZ_ORDER_BASE + 2);
  });

  await t.test("an explicit order already in the zone is used as-is", async () => {
    prisma.quiz.findFirst = async () => null;
    let capturedData;
    prisma.quiz.create = async ({ data }) => {
      capturedData = data;
      return { ...data, id: "new-quiz-id" };
    };
    prisma.quiz.findUnique = async () => ({ id: "new-quiz-id", quizQuestions: [] });
    prisma.course.findUnique = async () => ({ title: "Some Course" });

    await quizService.createQuiz({
      title: "Already Banded Quiz", passingScore: 70, courseId: "c1", order: QUIZ_ORDER_BASE + 9,
    });

    assert.strictEqual(capturedData.order, QUIZ_ORDER_BASE + 9);
  });

  await t.test("a negative or zero explicit order clamps to the first local-index slot, never escaping below the zone", async () => {
    prisma.quiz.findFirst = async () => null;
    let capturedData;
    prisma.quiz.create = async ({ data }) => {
      capturedData = data;
      return { ...data, id: "new-quiz-id" };
    };
    prisma.quiz.findUnique = async () => ({ id: "new-quiz-id", quizQuestions: [] });
    prisma.course.findUnique = async () => ({ title: "Some Course" });

    await quizService.createQuiz({
      title: "Negative Order Quiz", passingScore: 70, courseId: "c1", order: -5,
    });

    assert.strictEqual(capturedData.order, QUIZ_ORDER_BASE + 1);
    assert.ok(capturedData.order >= QUIZ_ORDER_BASE);
  });

  await t.test("an explicit order past the Assignment zone clamps back inside the Quiz zone", async () => {
    prisma.quiz.findFirst = async () => null;
    let capturedData;
    prisma.quiz.create = async ({ data }) => {
      capturedData = data;
      return { ...data, id: "new-quiz-id" };
    };
    prisma.quiz.findUnique = async () => ({ id: "new-quiz-id", quizQuestions: [] });
    prisma.course.findUnique = async () => ({ title: "Some Course" });

    await quizService.createQuiz({
      title: "Overflow Order Quiz", passingScore: 70, courseId: "c1", order: 5_000_000,
    });

    assert.ok(capturedData.order < ASSIGNMENT_ORDER_BASE, `expected ${capturedData.order} to stay under ASSIGNMENT_ORDER_BASE`);
    assert.ok(capturedData.order >= QUIZ_ORDER_BASE);
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

test("createQuiz — an explicit order that is already taken shifts the scope's quizzes down", async (t) => {
  const originals = {
    findFirst: prisma.quiz.findFirst,
    findMany: prisma.quiz.findMany,
    update: prisma.quiz.update,
    create: prisma.quiz.create,
    findUnique: prisma.quiz.findUnique,
    transaction: prisma.$transaction,
    courseFindUnique: prisma.course.findUnique,
  };
  t.after(() => {
    prisma.quiz.findFirst = originals.findFirst;
    prisma.quiz.findMany = originals.findMany;
    prisma.quiz.update = originals.update;
    prisma.quiz.create = originals.create;
    prisma.quiz.findUnique = originals.findUnique;
    prisma.$transaction = originals.transaction;
    prisma.course.findUnique = originals.courseFindUnique;
  });

  let occupancyWhere;
  prisma.quiz.findFirst = async ({ where }) => {
    occupancyWhere = where;
    return { id: "existing-at-slot" };
  };
  let shiftWhere;
  prisma.quiz.findMany = async ({ where }) => {
    shiftWhere = where;
    return [
      { id: "q1", order: QUIZ_ORDER_BASE + 1 },
      { id: "q2", order: QUIZ_ORDER_BASE + 2 },
    ];
  };
  prisma.quiz.update = ({ where, data }) => ({ kind: "update", id: where.id, order: data.order });
  prisma.quiz.create = ({ data }) => ({ kind: "create", data });
  let transactionOps;
  prisma.$transaction = async (ops) => {
    transactionOps = ops;
    return ops.map((op) => (op.kind === "create" ? { ...op.data, id: "new-quiz-id" } : op));
  };
  prisma.quiz.findUnique = async () => ({ id: "new-quiz-id", quizQuestions: [] });
  prisma.course.findUnique = async () => ({ title: "Some Course" });

  await quizService.createQuiz({ title: "Inserted Quiz", passingScore: 70, courseId: "c1", order: 1 });

  const courseScope = { courseId: "c1", moduleId: null, lessonId: null, topicId: null };
  assert.deepStrictEqual(occupancyWhere, { ...courseScope, order: QUIZ_ORDER_BASE + 1 });
  assert.deepStrictEqual(shiftWhere, { ...courseScope, order: { gte: QUIZ_ORDER_BASE + 1, lt: ASSIGNMENT_ORDER_BASE } });

  // Park on negatives, then land one slot later, then insert — all in one transaction.
  assert.deepStrictEqual(
    transactionOps.map((op) => (op.kind === "create" ? ["create", op.data.order] : [op.id, op.order])),
    [
      ["q1", -(QUIZ_ORDER_BASE + 1)],
      ["q2", -(QUIZ_ORDER_BASE + 2)],
      ["q1", QUIZ_ORDER_BASE + 2],
      ["q2", QUIZ_ORDER_BASE + 3],
      ["create", QUIZ_ORDER_BASE + 1],
    ]
  );
});
