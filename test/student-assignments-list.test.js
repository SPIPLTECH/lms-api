const test = require("node:test");
const assert = require("node:assert");

const assignmentService = require("../src/modules/assignments/assignment.service");
const prisma = require("../src/config/database");

// The student Assignments page is the lasting record of every assignment and
// its grade. Every assignment is an Assignment row at some level of the course,
// so getAssignments reads them in one query and resolves each one's course and
// lesson from whichever level it hangs off.
test("getAssignments lists every level's assignments with grades and feedback", async (t) => {
  const original = prisma.assignment.findMany;
  t.after(() => {
    prisma.assignment.findMany = original;
  });

  const course = { id: "c1", title: "Course" };
  const lesson = { id: "l1", module: { id: "m1", title: "Module 1", course } };
  let args = null;

  prisma.assignment.findMany = async (a) => {
    args = a;
    return [
      {
        id: "a1",
        title: "Essay",
        description: "Write it",
        dueDate: new Date(),
        createdAt: new Date(),
        course,
        content: { id: "ct1" },
        submissions: [{ status: "Graded", grade: "A", feedback: "Great", submittedAt: new Date() }],
      },
      {
        id: "a2",
        title: "Topic task",
        dueDate: new Date(),
        createdAt: new Date(),
        course: null,
        module: null,
        lesson: null,
        topic: { lessonId: "l1", lesson },
        content: null,
        submissions: [],
      },
    ];
  };

  const list = await assignmentService.getAssignments("s1");

  assert.strictEqual(args.where.isPublished, true);
  assert.strictEqual(args.include.submissions.where.studentId, "s1");

  const byId = Object.fromEntries(list.map((a) => [a.id, a]));
  assert.strictEqual(list.length, 2);

  assert.strictEqual(byId.a1.status, "Graded");
  assert.strictEqual(byId.a1.grade, "A");
  assert.strictEqual(byId.a1.feedback, "Great");
  assert.deepStrictEqual(byId.a1.course, course);
  assert.strictEqual(byId.a1.contentId, "ct1");

  assert.strictEqual(byId.a2.status, "Not Submitted");
  assert.strictEqual(byId.a2.grade, null);
  assert.deepStrictEqual(byId.a2.course, course, "course resolved through topic -> lesson -> module");
  assert.strictEqual(byId.a2.moduleTitle, "Module 1");
  assert.strictEqual(byId.a2.lessonId, "l1");
  assert.strictEqual(byId.a2.contentId, null);
});
