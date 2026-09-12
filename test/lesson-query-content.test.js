const test = require("node:test");
const assert = require("node:assert");

const lessonQueryService = require("../src/modules/lesson-queries/lessonQuery.service");
const { createLessonQuerySchema } = require("../src/modules/lesson-queries/lessonQuery.validation");
const prisma = require("../src/config/database");

// Questions from the Ask Instructor popover carry the one item the student
// was on — a content block, a quiz or an assignment. The lesson is derived
// from it server-side, and the question is only listed back on that item.
test("createQuery scoped to an item", async (t) => {
  const originals = {
    studentFind: prisma.studentProfile.findUnique,
    contentFind: prisma.content.findUnique,
    quizFind: prisma.quiz.findUnique,
    assignmentFind: prisma.assignment.findUnique,
    lessonFind: prisma.lesson.findUnique,
    enrollmentFind: prisma.enrollment.findFirst,
    queryCreate: prisma.lessonQuery.create,
  };
  t.after(() => {
    prisma.studentProfile.findUnique = originals.studentFind;
    prisma.content.findUnique = originals.contentFind;
    prisma.quiz.findUnique = originals.quizFind;
    prisma.assignment.findUnique = originals.assignmentFind;
    prisma.lesson.findUnique = originals.lessonFind;
    prisma.enrollment.findFirst = originals.enrollmentFind;
    prisma.lessonQuery.create = originals.queryCreate;
  });

  const inTopicOfLesson = (id, lessonId) => ({
    id,
    lessonId: null,
    courseId: null,
    module: null,
    lesson: null,
    topic: { lessonId, lesson: { module: { courseId: "c1" } } },
  });

  let created;
  let lessonLookedUp;
  t.beforeEach(() => {
    created = null;
    lessonLookedUp = null;
    prisma.studentProfile.findUnique = async () => ({ id: "s1" });
    prisma.lesson.findUnique = async ({ where }) => {
      lessonLookedUp = where.id;
      return { id: where.id, module: { courseId: "c1" } };
    };
    prisma.enrollment.findFirst = async () => ({ id: "e1" });
    prisma.lessonQuery.create = async ({ data }) => {
      created = data;
      return { id: "q1", ...data };
    };
  });

  await t.test("content in a topic is filed under the topic's lesson", async () => {
    prisma.content.findUnique = async () => inTopicOfLesson("ct1", "l1");

    await lessonQueryService.createQuery("u1", { contentId: "ct1", question: "  Why?  " });

    assert.strictEqual(lessonLookedUp, "l1");
    assert.deepStrictEqual(created, {
      lessonId: "l1",
      studentId: "s1",
      question: "Why?",
      contentId: "ct1",
      quizId: null,
      assignmentId: null,
    });
  });

  await t.test("a quiz question is tied to the quiz only", async () => {
    prisma.quiz.findUnique = async () => ({ ...inTopicOfLesson("qz1", "l1"), courseId: "c1" });

    await lessonQueryService.createQuery("u1", { quizId: "qz1", question: "Q about quiz" });

    assert.strictEqual(created.quizId, "qz1");
    assert.strictEqual(created.contentId, null);
    assert.strictEqual(created.assignmentId, null);
    assert.strictEqual(created.lessonId, "l1");
  });

  await t.test("an assignment question is tied to the assignment only", async () => {
    prisma.assignment.findUnique = async () => ({
      id: "as1",
      lessonId: "l2",
      courseId: null,
      module: null,
      lesson: { module: { courseId: "c1" } },
      topic: null,
    });

    await lessonQueryService.createQuery("u1", { assignmentId: "as1", question: "Q about assignment" });

    assert.strictEqual(created.assignmentId, "as1");
    assert.strictEqual(created.lessonId, "l2");
    assert.strictEqual(created.quizId, null);
  });

  await t.test("lesson-only questions still work as before", async () => {
    await lessonQueryService.createQuery("u1", { lessonId: "l9", question: "General question" });
    assert.strictEqual(created.lessonId, "l9");
    assert.strictEqual(created.contentId, null);
    assert.strictEqual(created.quizId, null);
    assert.strictEqual(created.assignmentId, null);
  });

  await t.test("an item from another course is rejected", async () => {
    prisma.content.findUnique = async () => ({
      id: "ct2",
      lessonId: null,
      courseId: "other-course",
      module: null,
      lesson: null,
      topic: null,
    });

    await assert.rejects(
      lessonQueryService.createQuery("u1", { contentId: "ct2", lessonId: "l1", question: "Q" }),
      (err) => err.statusCode === 400
    );
    assert.strictEqual(created, null);
  });

  await t.test("an unenrolled student can't ask", async () => {
    prisma.content.findUnique = async () => inTopicOfLesson("ct1", "l1");
    prisma.enrollment.findFirst = async () => null;

    await assert.rejects(
      lessonQueryService.createQuery("u1", { contentId: "ct1", question: "Q" }),
      (err) => err.statusCode === 403
    );
    assert.strictEqual(created, null);
  });

  await t.test("an unknown quiz is a 404", async () => {
    prisma.quiz.findUnique = async () => null;
    await assert.rejects(
      lessonQueryService.createQuery("u1", { quizId: "nope", question: "Q" }),
      (err) => err.statusCode === 404
    );
  });
});

test("getQueriesForStudent keeps each item's questions to that item", async (t) => {
  const originals = {
    studentFind: prisma.studentProfile.findUnique,
    queryFindMany: prisma.lessonQuery.findMany,
  };
  t.after(() => {
    prisma.studentProfile.findUnique = originals.studentFind;
    prisma.lessonQuery.findMany = originals.queryFindMany;
  });

  let captured;
  prisma.studentProfile.findUnique = async () => ({ id: "s1" });
  prisma.lessonQuery.findMany = async (args) => {
    captured = args;
    return [];
  };

  await t.test("one content block", async () => {
    await lessonQueryService.getQueriesForStudent("u1", { contentId: "ct1" });
    assert.deepStrictEqual(captured.where, { studentId: "s1", contentId: "ct1" });
  });

  await t.test("one quiz", async () => {
    await lessonQueryService.getQueriesForStudent("u1", { quizId: "qz1" });
    assert.deepStrictEqual(captured.where, { studentId: "s1", quizId: "qz1" });
  });

  await t.test("lesson-wide excludes every item-specific question", async () => {
    await lessonQueryService.getQueriesForStudent("u1", { lessonId: "l1", lessonOnly: "true" });
    assert.deepStrictEqual(captured.where, {
      studentId: "s1",
      lessonId: "l1",
      contentId: null,
      quizId: null,
      assignmentId: null,
    });
  });

  await t.test("the student Q&A page (no filters) still sees everything", async () => {
    await lessonQueryService.getQueriesForStudent("u1", {});
    assert.deepStrictEqual(captured.where, { studentId: "s1" });
  });
});

test("createLessonQuerySchema", () => {
  const ok = (body) => assert.strictEqual(createLessonQuerySchema.validate(body).error, undefined);
  const bad = (body) => assert.ok(createLessonQuerySchema.validate(body).error);

  ok({ lessonId: "l1", question: "Q" });
  ok({ contentId: "c1", question: "Q" });
  ok({ quizId: "q1", lessonId: "l1", question: "Q" });
  ok({ assignmentId: "a1", question: "Q" });
  bad({ question: "Q" });
  bad({ contentId: "c1", question: "   " });
  bad({ contentId: "c1", quizId: "q1", question: "Q" }); // only one item
});
