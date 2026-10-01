const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const QuestionUploadParser = require("../src/modules/questions/services/QuestionUploadParser");

// The bulk question upload's optional `course` / `module` columns — the file
// counterpart of the Course and Module dropdowns on the single-question form.
// Stub clients only: nothing here reaches the database.

const COURSES = [
  {
    id: "course-py",
    title: "Python Basics",
    modules: [
      { id: "mod-lists", title: "Lists" },
      { id: "mod-loops", title: "Loops" },
    ],
  },
  { id: "course-web-1", title: "Web Development", modules: [] },
  { id: "course-web-2", title: "Web Development", modules: [] },
];

function stubPrisma(t, courses = COURSES) {
  const originalQuestionFindMany = prisma.question.findMany;
  const originalCourseFindMany = prisma.course.findMany;
  const courseQueries = [];

  prisma.question.findMany = async () => [];
  prisma.course.findMany = async (args) => {
    courseQueries.push(args);
    return courses;
  };

  t.after(() => {
    prisma.question.findMany = originalQuestionFindMany;
    prisma.course.findMany = originalCourseFindMany;
  });
  return courseQueries;
}

const mcq = (question, extra = {}) => ({
  question,
  type: "MCQ_SINGLE",
  marks: 1,
  options: ["a", "b"],
  correctAnswer: "a",
  ...extra,
});

const parse = (rows, user = { id: "inst-1", role: "INSTRUCTOR" }) =>
  QuestionUploadParser.parseAndValidate(Buffer.from(JSON.stringify(rows)), "questions.json", user.id, user);

test("a row's course and module are resolved by title or by id", async (t) => {
  stubPrisma(t);

  const report = await parse([
    mcq("By title", { course: "python basics", module: " Lists " }),
    mcq("By id", { courseId: "course-py", moduleId: "mod-loops" }),
    mcq("Course only", { course: "Python Basics" }),
  ]);

  assert.strictEqual(report.failedCount, 0);
  assert.deepStrictEqual(
    report.validQuestions.map((q) => [q.courseId, q.moduleId]),
    [
      ["course-py", "mod-lists"],
      ["course-py", "mod-loops"],
      ["course-py", null],
    ]
  );
});

test("a file with no course column imports as before, without reading courses", async (t) => {
  const courseQueries = stubPrisma(t);

  const report = await parse([mcq("No course")]);

  assert.strictEqual(report.successCount, 1);
  assert.strictEqual(report.validQuestions[0].courseId, null);
  assert.strictEqual(report.validQuestions[0].moduleId, null);
  assert.strictEqual(courseQueries.length, 0);
});

test("an instructor may only name their own courses; an admin may name any", async (t) => {
  const courseQueries = stubPrisma(t);

  await parse([mcq("Mine", { course: "Python Basics" })]);
  await parse([mcq("Any", { course: "Python Basics" })], { id: "admin-1", role: "ADMIN" });

  assert.deepStrictEqual(courseQueries[0].where, { creatorId: "inst-1" });
  assert.deepStrictEqual(courseQueries[1].where, {});
});

test("an unknown, ambiguous or mismatched course/module fails that row only", async (t) => {
  stubPrisma(t);

  const report = await parse([
    mcq("Unknown course", { course: "Rust" }),
    mcq("Two courses share the title", { course: "Web Development" }),
    mcq("Module from another course", { course: "Python Basics", module: "HTTP" }),
    mcq("Module without a course", { module: "Lists" }),
    mcq("Fine", { course: "course-web-2" }),
  ]);

  assert.deepStrictEqual(
    report.errors.map((e) => [e.row, e.code]),
    [
      [1, "COURSE_NOT_FOUND"],
      [2, "COURSE_AMBIGUOUS"],
      [3, "MODULE_NOT_FOUND"],
      [4, "MODULE_WITHOUT_COURSE"],
    ]
  );
  assert.strictEqual(report.successCount, 1);
  assert.strictEqual(report.validQuestions[0].courseId, "course-web-2");
});

test("CSV course and module columns are read the same way", async (t) => {
  stubPrisma(t);

  const csv = [
    "question,type,marks,option1,option2,correctAnswer,course,module",
    "From a sheet,MCQ_SINGLE,1,a,b,option 1,Python Basics,Loops",
    "No course in this row,MCQ_SINGLE,1,a,b,option 1,,",
  ].join("\n");

  const report = await QuestionUploadParser.parseAndValidate(Buffer.from(csv), "questions.csv", "inst-1", {
    id: "inst-1",
    role: "INSTRUCTOR",
  });

  assert.strictEqual(report.failedCount, 0);
  assert.deepStrictEqual(
    report.validQuestions.map((q) => [q.courseId, q.moduleId]),
    [
      ["course-py", "mod-loops"],
      [null, null],
    ]
  );
});
