const test = require("node:test");
const assert = require("node:assert");

const resultsService = require("../src/modules/results/results.service");
const prisma = require("../src/config/database");

// getFinalTestOverview groups BY TEST, unlike getResults which returns one row
// per attempt. The instructor list draws a submission gauge from these counts,
// so the roster and the counts have to agree exactly.
test("getFinalTestOverview", async (t) => {
  const originals = {
    courseFindMany: prisma.course.findMany,
    quizFindMany: prisma.quiz.findMany,
    enrollmentFindMany: prisma.enrollment.findMany,
    submissionFindMany: prisma.quizSubmission.findMany,
  };
  t.after(() => {
    prisma.course.findMany = originals.courseFindMany;
    prisma.quiz.findMany = originals.quizFindMany;
    prisma.enrollment.findMany = originals.enrollmentFindMany;
    prisma.quizSubmission.findMany = originals.submissionFindMany;
  });

  const course = { id: "c1", title: "Course", status: "PUBLISHED", _count: { enrollments: 3 } };
  const student = (id, name) => ({
    courseId: "c1",
    student: { id, user: { name, email: `${id}@example.com` } },
  });

  let capturedQuizArgs;
  prisma.course.findMany = async () => [{ id: "c1" }];
  prisma.quiz.findMany = async (args) => {
    capturedQuizArgs = args;
    return [
      {
        id: "q1",
        title: "Final test",
        passingScore: 50,
        courseId: "c1",
        course: null,
        module: null,
        lesson: null,
        // Attached at topic level, so every crumb above it must resolve.
        topic: { title: "T1", lesson: { title: "L1", module: { title: "M1", course } } },
      },
    ];
  };
  // Three enrolled; only two of them ever sat the test.
  prisma.enrollment.findMany = async () => [
    student("s1", "Pawan"),
    student("s2", "Ana"),
    student("s3", "Ron"),
  ];
  prisma.quizSubmission.findMany = async () => [
    // Newest first, matching the service's orderBy. s1 sat it twice.
    { quizId: "q1", studentId: "s1", score: 9, totalMarks: 10, percentage: 90, passed: true, submittedAt: new Date("2026-03-02") },
    { quizId: "q1", studentId: "s1", score: 3, totalMarks: 10, percentage: 30, passed: false, submittedAt: new Date("2026-03-01") },
    { quizId: "q1", studentId: "s2", score: 2, totalMarks: 10, percentage: 20, passed: false, submittedAt: new Date("2026-03-01") },
  ];

  await t.test("scopes to Final tests in the instructor's courses", async () => {
    await resultsService.getFinalTestOverview("i1", {});

    assert.strictEqual(capturedQuizArgs.where.quizTag, "FINAL");
    assert.deepStrictEqual(capturedQuizArgs.where.courseId, { in: ["c1"] });
  });

  await t.test("resolves the full breadcrumb from the attachment point", async () => {
    const [testRow] = await resultsService.getFinalTestOverview("i1", {});

    assert.strictEqual(testRow.course.title, "Course");
    assert.strictEqual(testRow.moduleTitle, "M1");
    assert.strictEqual(testRow.lessonTitle, "L1");
    assert.strictEqual(testRow.topicTitle, "T1");
  });

  await t.test("counts attempts against enrolment, not against submissions", async () => {
    const [testRow] = await resultsService.getFinalTestOverview("i1", {});

    assert.strictEqual(testRow.enrolledCount, 3);
    assert.strictEqual(testRow.attemptedCount, 2);
    assert.strictEqual(testRow.notAttemptedCount, 1);
    // s2 failed; s1's LATEST attempt passed, so s1 is not counted as failed.
    assert.strictEqual(testRow.failedCount, 1);
  });

  await t.test("lists every enrolled student, including those who never sat it", async () => {
    const [testRow] = await resultsService.getFinalTestOverview("i1", {});

    assert.strictEqual(testRow.students.length, 3);
    // The gauge denominator and the table must never disagree.
    assert.strictEqual(testRow.students.length, testRow.enrolledCount);

    const ron = testRow.students.find((s) => s.studentId === "s3");
    assert.strictEqual(ron.attempted, false);
    assert.strictEqual(ron.attemptsCount, 0);
    assert.strictEqual(ron.score, null);
    assert.strictEqual(ron.passed, null);
    assert.strictEqual(ron.submittedAt, null);
  });

  await t.test("shows a retaker's latest attempt, and how many they made", async () => {
    const [testRow] = await resultsService.getFinalTestOverview("i1", {});
    const pawan = testRow.students.find((s) => s.studentId === "s1");

    assert.strictEqual(pawan.attemptsCount, 2);
    // The 90% run on Mar 2, not the 30% one on Mar 1.
    assert.strictEqual(pawan.percentage, 90);
    assert.strictEqual(pawan.passed, true);
  });

  await t.test("returns nothing when the instructor owns no courses", async () => {
    prisma.course.findMany = async () => [];
    assert.deepStrictEqual(await resultsService.getFinalTestOverview("i1", {}), []);
    prisma.course.findMany = async () => [{ id: "c1" }];
  });

  await t.test("returns nothing when a course has no Final tests", async () => {
    const quizFindMany = prisma.quiz.findMany;
    prisma.quiz.findMany = async () => [];
    assert.deepStrictEqual(await resultsService.getFinalTestOverview("i1", {}), []);
    prisma.quiz.findMany = quizFindMany;
  });
});
