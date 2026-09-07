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
  const originalModuleFindUnique = prisma.module.findUnique;
  const originalLessonFindUnique = prisma.lesson.findUnique;
  const originalTopicFindUnique = prisma.topic.findUnique;
  const originalBatchFindUnique = prisma.batch.findUnique;
  const originalCourseFindUnique = prisma.course.findUnique;

  t.after(() => {
    prisma.content.findFirst = originalContentFindFirst;
    prisma.quiz.findFirst = originalQuizFindFirst;
    prisma.quiz.create = originalQuizCreate;
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

  await t.test("an explicit order is used verbatim, not overwritten", async () => {
    prisma.content.findFirst = async () => ({ order: 99 });
    prisma.quiz.findFirst = async () => ({ order: 99 });
    let capturedData;
    prisma.quiz.create = async ({ data }) => {
      capturedData = data;
      return { ...data, id: "new-quiz-id" };
    };
    prisma.course.findUnique = async () => ({ title: "Some Course" });

    await quizService.createQuiz({
      title: "Positioned Quiz", passingScore: 70, courseId: "c1", order: 2,
    });

    assert.strictEqual(capturedData.order, 2);
  });
});
