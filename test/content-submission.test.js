const test = require("node:test");
const assert = require("node:assert");

const contentService = require("../src/modules/contents/content.service");
const progressService = require("../src/modules/progress/progress.service");
const prisma = require("../src/config/database");

const STUDENT = { id: "u1", role: "STUDENT" };
const PDF = {
  fileUrl: "https://blob.example/assignment-submissions/work.pdf",
  fileName: "work.pdf",
  fileSize: 1234,
  fileType: "application/pdf",
};

const assignmentContent = (overrides = {}) => ({
  id: "ct1",
  type: "ASSIGNMENT",
  topic: { lesson: { module: { courseId: "c1" } } },
  lesson: null,
  module: null,
  courseId: null,
  ...overrides,
});

test("submitContentAssignment", async (t) => {
  const originals = {
    contentFindUnique: prisma.content.findUnique,
    enrollmentFindUnique: prisma.enrollment.findUnique,
    submissionUpsert: prisma.contentSubmission.upsert,
    completeContent: progressService.completeContent,
  };

  t.after(() => {
    prisma.content.findUnique = originals.contentFindUnique;
    prisma.enrollment.findUnique = originals.enrollmentFindUnique;
    prisma.contentSubmission.upsert = originals.submissionUpsert;
    progressService.completeContent = originals.completeContent;
  });

  let upserts;
  let completions;
  t.beforeEach(() => {
    upserts = [];
    completions = [];
    prisma.enrollment.findUnique = async () => ({ id: "e1" });
    prisma.contentSubmission.upsert = async (args) => {
      upserts.push(args);
      return { status: "Submitted", submittedAt: new Date(), ...args.create };
    };
    progressService.completeContent = async (...args) => {
      completions.push(args);
    };
  });

  await t.test("records the PDF and completes the content block", async () => {
    prisma.content.findUnique = async () => assignmentContent();

    const result = await contentService.submitContentAssignment("ct1", "s1", PDF, STUDENT);

    assert.strictEqual(upserts.length, 1);
    assert.deepStrictEqual(upserts[0].where, { studentId_contentId: { studentId: "s1", contentId: "ct1" } });
    assert.strictEqual(upserts[0].create.fileUrl, PDF.fileUrl);
    assert.strictEqual(upserts[0].update.fileName, PDF.fileName);
    assert.deepStrictEqual(completions, [["s1", "ct1", true]]);
    assert.strictEqual(result.fileName, "work.pdf");
  });

  await t.test("accepts a written answer with no PDF", async () => {
    prisma.content.findUnique = async () => assignmentContent();

    await contentService.submitContentAssignment("ct1", "s1", { textAnswer: "  My answer  " }, STUDENT);

    assert.strictEqual(upserts[0].create.textAnswer, "My answer");
    assert.strictEqual(upserts[0].create.fileUrl, null);
    assert.strictEqual(upserts[0].update.fileName, null);
    assert.deepStrictEqual(completions, [["s1", "ct1", true]]);
  });

  await t.test("rejects a submission with neither a PDF nor an answer", async () => {
    prisma.content.findUnique = async () => assignmentContent();

    await assert.rejects(
      contentService.submitContentAssignment("ct1", "s1", { textAnswer: "   " }, STUDENT),
      (err) => err.statusCode === 400
    );
    assert.strictEqual(upserts.length, 0);
    assert.strictEqual(completions.length, 0);
  });

  await t.test("rejects content that is not an assignment", async () => {
    prisma.content.findUnique = async () => assignmentContent({ type: "VIDEO" });

    await assert.rejects(
      contentService.submitContentAssignment("ct1", "s1", PDF, STUDENT),
      (err) => err.statusCode === 400
    );
    assert.strictEqual(upserts.length, 0);
    assert.strictEqual(completions.length, 0);
  });

  await t.test("rejects a student not enrolled in the course", async () => {
    prisma.content.findUnique = async () => assignmentContent();
    prisma.enrollment.findUnique = async () => null;

    await assert.rejects(
      contentService.submitContentAssignment("ct1", "s1", PDF, STUDENT),
      (err) => err.statusCode === 403
    );
    assert.strictEqual(upserts.length, 0);
    assert.strictEqual(completions.length, 0);
  });

  await t.test("404s on unknown content", async () => {
    prisma.content.findUnique = async () => null;

    await assert.rejects(
      contentService.submitContentAssignment("missing", "s1", PDF, STUDENT),
      (err) => err.statusCode === 404
    );
    assert.strictEqual(upserts.length, 0);
  });
});

test("instructor views of content assignments", async (t) => {
  const originals = {
    contentFindMany: prisma.content.findMany,
    contentFindUnique: prisma.content.findUnique,
    submissionFindMany: prisma.contentSubmission.findMany,
  };

  t.after(() => {
    prisma.content.findMany = originals.contentFindMany;
    prisma.content.findUnique = originals.contentFindUnique;
    prisma.contentSubmission.findMany = originals.submissionFindMany;
  });

  await t.test("lists only ASSIGNMENT blocks in the instructor's own courses", async () => {
    let captured = null;
    prisma.content.findMany = async (args) => {
      captured = args;
      return [
        {
          id: "ct1",
          title: "First Assignment",
          htmlContent: "brief",
          course: null,
          module: null,
          lesson: null,
          topic: { title: "First topic", lesson: { title: "L1", module: { course: { id: "c1", title: "Course" } } } },
          _count: { submissions: 2 },
          createdAt: new Date(),
        },
      ];
    };

    const result = await contentService.getInstructorAssignmentContents("i1", "INSTRUCTOR");

    assert.strictEqual(captured.where.type, "ASSIGNMENT");
    assert.ok(Array.isArray(captured.where.OR));
    assert.deepStrictEqual(result[0].course, { id: "c1", title: "Course" });
    assert.strictEqual(result[0].lessonTitle, "L1");
    assert.strictEqual(result[0].pendingSubmissionsCount, 2);
  });

  await t.test("ADMIN is not scoped to an owner", async () => {
    let captured = null;
    prisma.content.findMany = async (args) => {
      captured = args;
      return [];
    };

    await contentService.getInstructorAssignmentContents("a1", "ADMIN");
    assert.strictEqual(captured.where.OR, undefined);
  });

  await t.test("returns each student's submitted PDF", async () => {
    prisma.content.findUnique = async () => ({ id: "ct1", title: "First Assignment", type: "ASSIGNMENT" });
    prisma.contentSubmission.findMany = async () => [
      {
        id: "sub1",
        studentId: "s1",
        status: "Submitted",
        grade: null,
        feedback: null,
        submittedAt: new Date(),
        ...PDF,
        student: { id: "s1", user: { id: "u1", name: "Pawan", email: "p@example.com" } },
      },
    ];

    const result = await contentService.getContentSubmissions("ct1");

    assert.strictEqual(result.submissions.length, 1);
    assert.strictEqual(result.submissions[0].studentName, "Pawan");
    assert.strictEqual(result.submissions[0].fileUrl, PDF.fileUrl);
  });

  await t.test("404s when the content is not an assignment", async () => {
    prisma.content.findUnique = async () => ({ id: "ct2", title: "Video", type: "VIDEO" });

    await assert.rejects(contentService.getContentSubmissions("ct2"), (err) => err.statusCode === 404);
  });
});

test("submitAssignmentSchema — a PDF, a written answer, or both", () => {
  const { submitAssignmentSchema } = require("../src/modules/assignments/assignment.validation");
  const ok = (body) => assert.strictEqual(submitAssignmentSchema.validate(body).error, undefined);
  const bad = (body) => assert.ok(submitAssignmentSchema.validate(body).error);

  ok(PDF);
  ok({ textAnswer: "My answer" });
  ok({ ...PDF, textAnswer: "Both" });
  bad({});
  bad({ textAnswer: "   " });
  bad({ fileUrl: PDF.fileUrl }); // a PDF still needs its file name
  bad({ fileUrl: "https://blob.example/x.docx", fileName: "x.docx" });
});
