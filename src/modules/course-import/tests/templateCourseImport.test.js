const test = require("node:test");
const assert = require("node:assert/strict");

const prisma = require("../../../config/database");
const { importV2Manifest } = require("../services/v2PackageImporter.service");
const { parseCourseJson } = require("../services/flexibleCourseJson.service");
const template = require("../fixtures/course_json_template.json");

const clone = (value) => JSON.parse(JSON.stringify(value));

// importV2Manifest does all its writing inside one prisma.$transaction, so the
// transaction is stubbed (as in course-import-answer-key.test.js) and every
// createMany is captured — nothing reaches the shared database.
function captureImport(t) {
  const original = prisma.$transaction;
  t.after(() => {
    prisma.$transaction = original;
  });

  const rows = { course: null, module: [], lesson: [], topic: [], content: [], quiz: [], question: [], quizQuestion: [], assignment: [] };
  prisma.$transaction = async (fn) => {
    const createMany = (table) => ({ createMany: async ({ data }) => { rows[table].push(...data); } });
    const tx = {
      course: { create: async ({ data }) => (rows.course = { id: "course-1", ...data }) },
      ...Object.fromEntries(Object.keys(rows).filter((k) => k !== "course").map((table) => [table, createMany(table)])),
    };
    return fn(tx);
  };
  return rows;
}

const parentOf = (row) => ["courseId", "moduleId", "lessonId", "topicId"].filter((key) => row[key]);

test("the reference template imports every level where it is nested", async (t) => {
  const rows = captureImport(t);
  const canonical = parseCourseJson(clone(template)).canonical;

  await importV2Manifest(canonical, "instructor-1");

  assert.equal(rows.course.title, "Introduction to Physics");
  assert.equal(rows.course.level, "Beginner");
  assert.equal(rows.course.status, "DRAFT");
  assert.equal(rows.course.thumbnailUrl, "https://blob.example.com/thumbnails/physics-intro.jpg", "a thumbnail URL is kept");
  assert.equal(rows.course.certificatesEnabled, false);
  assert.equal(rows.course.discussionEnabled, true);
  assert.deepEqual(rows.course.tags, ["physics", "beginner", "science", "mechanics"]);

  assert.equal(rows.module.length, 2);
  assert.equal(rows.lesson.length, 2);
  assert.equal(rows.topic.length, 3);
  assert.equal(rows.content.length, 9);
  assert.equal(rows.quiz.length, 8);
  assert.equal(rows.question.length, 13);
  assert.equal(rows.quizQuestion.length, 13);
  assert.equal(rows.assignment.length, 8);

  // Content and assignments hang off exactly one parent, at the level they were written.
  for (const row of [...rows.content, ...rows.assignment]) assert.equal(parentOf(row).length, 1, JSON.stringify(row));
  assert.deepEqual(
    rows.content.map((c) => [c.title, parentOf(c)[0]]),
    [
      ["What is Physics?", "courseId"],
      ["Why Learn Physics?", "courseId"],
      ["Introduction to Measurement", "moduleId"],
      ["Physical Quantities", "lessonId"],
      ["The Seven SI Base Units", "topicId"],
      ["Accuracy and Precision", "topicId"],
      ["Introduction to Motion", "moduleId"],
      ["Distance and Displacement", "lessonId"],
      ["Understanding Distance", "topicId"],
    ]
  );
  assert.deepEqual(rows.content[0].data.markdown.split("\n")[0], "## What is Physics?", "content data is kept as written");
  assert.equal(rows.assignment.find((a) => a.title === "Introduction to Physics Final Assignment").courseId, "course-1");
  assert.ok(rows.assignment.every((a) => a.dueDate instanceof Date && !Number.isNaN(a.dueDate.getTime())));

  // Quiz level comes from nesting; the tag keeps SELF_TEST apart from the assessments.
  const quiz = (title) => rows.quiz.find((q) => q.title === title);
  const levelOf = (q) => (q.topicId ? "topic" : q.lessonId ? "lesson" : q.moduleId ? "module" : "course");
  assert.deepEqual([levelOf(quiz("SI Units Quick Check")), quiz("SI Units Quick Check").quizTag, quiz("SI Units Quick Check").timeLimit], ["topic", "SELF_TEST", null]);
  assert.deepEqual([levelOf(quiz("Measurement Errors Quiz")), quiz("Measurement Errors Quiz").quizTag], ["topic", "SELF_TEST"]);
  assert.deepEqual([levelOf(quiz("Physical Quantities and SI Units - Lesson Quiz")), quiz("Physical Quantities and SI Units - Lesson Quiz").quizTag], ["lesson", "FINAL"]);
  assert.deepEqual([levelOf(quiz("Units and Measurements - Module Quiz")), quiz("Units and Measurements - Module Quiz").quizTag], ["module", "FINAL"]);
  assert.deepEqual([levelOf(quiz("Introduction to Physics - Final Course Quiz")), quiz("Introduction to Physics - Final Course Quiz").quizTag], ["course", "FINAL"]);

  // Orders and publish flags are kept as written.
  assert.deepEqual(rows.module.map((m) => m.order), [1, 2]);
  assert.deepEqual(rows.topic.map((tp) => [tp.title, tp.order, tp.isPublished]), [["SI Base Units", 1, false], ["Measurement Errors", 2, false], ["Distance", 1, false]]);
});

test("raw template JSON imports directly, and a sparse course creates only what it contains", async (t) => {
  const rows = captureImport(t);

  await importV2Manifest(
    {
      course: { title: "Sparse" },
      content: [{ type: "HTML", htmlContent: "<p>Welcome</p>" }],
      modules: [
        { title: "Reading only", content: [{ type: "VIDEO", title: "Watch", videoUrl: "https://videos.example.com/a.mp4" }] },
        { title: "One lesson", lessons: [{ title: "No topics", assignment: { title: "Essay", dueDate: "2026-12-01T23:59:00.000Z" } }] },
      ],
    },
    "instructor-1"
  );

  assert.equal(rows.module.length, 2);
  assert.equal(rows.lesson.length, 1, "no lesson is invented for the content-only module");
  assert.equal(rows.topic.length, 0, "no \"General\" topic is invented for the topic-less lesson");
  assert.equal(rows.quiz.length, 0);
  assert.deepEqual(rows.content.map((c) => [c.type, parentOf(c)[0], c.order]), [["HTML", "courseId", 1], ["VIDEO", "moduleId", 1]]);
  assert.equal(rows.content[1].videoUrl, "https://videos.example.com/a.mp4");
  assert.deepEqual(parentOf(rows.assignment[0]), ["lessonId"]);
  assert.equal(rows.assignment[0].isPublished, true);
});

test("the draft Composer's copy imports even though its IDs no longer match the template's", async (t) => {
  const rows = captureImport(t);
  const draft = parseCourseJson(clone(template)).canonical;
  // What the Composer does: replaces entity IDs and stamps quizzes with them.
  draft.modules[0].id = "2b1c-uuid";
  draft.modules[0].quizzes[0].moduleId = "2b1c-uuid";

  await importV2Manifest(draft, "instructor-1");
  assert.equal(rows.quiz.length, 8);
});

test("an import the LMS cannot store is refused with the reasons, before anything is written", async (t) => {
  const rows = captureImport(t);

  await assert.rejects(
    () => importV2Manifest({ course: { title: "No due date" }, modules: [{ title: "A", assignment: { title: "Essay" } }] }, "instructor-1"),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.code, "COURSE_JSON_INVALID");
      assert.deepEqual(err.errors, [
        'modules[0].assignment.dueDate is required — the LMS needs a due date for every assignment (ISO 8601, e.g. "2026-11-15T23:59:00.000Z").',
      ]);
      return true;
    }
  );
  assert.equal(rows.course, null);
});

test("imported quizzes sit after their level's content, where the course map lists them", async (t) => {
  const rows = captureImport(t);
  await importV2Manifest(parseCourseJson(clone(template)).canonical, "instructor-1");

  const courseContentOrders = rows.content.filter((c) => c.courseId).map((c) => c.order);
  const courseQuiz = rows.quiz.find((q) => !q.moduleId && !q.lessonId && !q.topicId);
  assert.deepEqual(courseContentOrders, [1, 2]);
  assert.equal(courseQuiz.order, 3);
  assert.ok(rows.quiz.every((q) => Number.isInteger(q.order)), "no imported quiz is left without an order");
});
