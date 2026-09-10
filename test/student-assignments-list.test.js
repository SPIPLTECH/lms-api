const test = require("node:test");
const assert = require("node:assert");

const assignmentService = require("../src/modules/assignments/assignment.service");
const prisma = require("../src/config/database");

// The student Assignments page is the lasting record of every assignment and
// its grade, so getAssignments must list lesson-composer (Content) assignments
// alongside Assignment rows, each carrying its grade and feedback.
test("getAssignments lists both kinds with grades and feedback", async (t) => {
  const originals = {
    assignmentFindMany: prisma.assignment.findMany,
    contentFindMany: prisma.content.findMany,
  };
  t.after(() => {
    prisma.assignment.findMany = originals.assignmentFindMany;
    prisma.content.findMany = originals.contentFindMany;
  });

  const course = { id: "c1", title: "Course" };
  let contentArgs = null;

  prisma.assignment.findMany = async () => [
    {
      id: "a1",
      title: "Essay",
      description: "Write it",
      dueDate: new Date(),
      createdAt: new Date(),
      course,
      submissions: [{ status: "Graded", grade: "A", feedback: "Great", submittedAt: new Date() }],
    },
  ];
  prisma.content.findMany = async (args) => {
    contentArgs = args;
    return [
      {
        id: "ct1",
        title: "First Assignment",
        htmlContent: "brief",
        createdAt: new Date(),
        lessonId: null,
        course: null,
        module: null,
        lesson: null,
        topic: { lessonId: "l1", lesson: { module: { course } } },
        submissions: [{ status: "Graded", grade: "8/10", feedback: "Good", submittedAt: new Date() }],
      },
      {
        id: "ct2",
        title: null,
        htmlContent: null,
        createdAt: new Date(),
        lessonId: "l2",
        course: null,
        module: null,
        lesson: { module: { course } },
        topic: null,
        submissions: [],
      },
    ];
  };

  const list = await assignmentService.getAssignments("s1");

  assert.strictEqual(contentArgs.where.type, "ASSIGNMENT");
  assert.strictEqual(contentArgs.include.submissions.where.studentId, "s1");

  const byId = Object.fromEntries(list.map((a) => [a.id, a]));
  assert.strictEqual(list.length, 3);

  assert.strictEqual(byId.a1.kind, "assignment");
  assert.strictEqual(byId.a1.grade, "A");
  assert.strictEqual(byId.a1.feedback, "Great");

  assert.strictEqual(byId.ct1.kind, "content");
  assert.strictEqual(byId.ct1.status, "Graded");
  assert.strictEqual(byId.ct1.grade, "8/10");
  assert.strictEqual(byId.ct1.feedback, "Good");
  assert.deepStrictEqual(byId.ct1.course, course);
  assert.strictEqual(byId.ct1.lessonId, "l1");

  assert.strictEqual(byId.ct2.status, "Not Submitted");
  assert.strictEqual(byId.ct2.grade, null);
  assert.strictEqual(byId.ct2.title, "Assignment");
  assert.strictEqual(byId.ct2.lessonId, "l2");
});
