const test = require("node:test");
const assert = require("node:assert");

const resultsService = require("../src/modules/results/results.service");
const prisma = require("../src/config/database");

// The instructor "Final test results" view asks /results for quizTag=FINAL
// so learner Self-Test attempts never appear among formal test scores.
test("getResults — quizTag filter", async (t) => {
  const originals = {
    courseFindMany: prisma.course.findMany,
    submissionFindMany: prisma.quizSubmission.findMany,
    enrollmentCount: prisma.enrollment.count,
    assignmentSubmissionCount: prisma.assignmentSubmission.count,
  };
  t.after(() => {
    prisma.course.findMany = originals.courseFindMany;
    prisma.quizSubmission.findMany = originals.submissionFindMany;
    prisma.enrollment.count = originals.enrollmentCount;
    prisma.assignmentSubmission.count = originals.assignmentSubmissionCount;
  });

  let captured;
  prisma.course.findMany = async () => [{ id: "c1" }];
  prisma.enrollment.count = async () => 1;
  prisma.assignmentSubmission.count = async () => 0;
  prisma.quizSubmission.findMany = async (args) => {
    captured = args;
    return [
      {
        id: "qs1",
        studentId: "s1",
        score: 8,
        totalMarks: 10,
        percentage: 80,
        passed: true,
        submittedAt: new Date(),
        answers: [],
        quiz: { id: "q1", title: "Final test", passingScore: 50, quizQuestions: [], course: { id: "c1", title: "Course" } },
        student: { user: { id: "u1", name: "Pawan", email: "p@example.com" } },
      },
    ];
  };

  await t.test("FINAL narrows the query to Final tests", async () => {
    const result = await resultsService.getResults("i1", { quizTag: "FINAL" });

    assert.strictEqual(captured.where.quiz.quizTag, "FINAL");
    assert.deepStrictEqual(captured.where.quiz.courseId, { in: ["c1"] });
    const row = result.studentResults[0];
    assert.strictEqual(row.courseTitle, "Course");
    assert.strictEqual(row.studentEmail, "p@example.com");
    assert.strictEqual(row.score, 8);
    assert.strictEqual(row.totalMarks, 10);
  });

  await t.test("no tag keeps every quiz (existing callers unchanged)", async () => {
    await resultsService.getResults("i1", {});
    assert.strictEqual(captured.where.quiz.quizTag, undefined);
  });

  await t.test("an unknown tag is ignored, not passed to Prisma", async () => {
    await resultsService.getResults("i1", { quizTag: "BOGUS" });
    assert.strictEqual(captured.where.quiz.quizTag, undefined);
  });
});
