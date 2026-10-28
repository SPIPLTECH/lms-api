const test = require("node:test");
const assert = require("node:assert");

const { classifyStudent, overallStatus, treeStats } = require("../src/modules/students/student.service");
const { recomputeCourseProgress, computeCourseProgressForStudents } = require("../src/utils/progressRollup");
const prisma = require("../src/config/database");

test("classifyStudent — Student Directory status rules", () => {
  const base = { progress: 50, started: true, finalAverage: null, courseAverage: 50, classmates: 3 };

  assert.strictEqual(classifyStudent({ ...base, started: false, progress: 0 }), "Not Started");
  assert.strictEqual(classifyStudent({ ...base, finalAverage: 40 }), "Struggling");
  // Failing Final tests outranks a high progress number.
  assert.strictEqual(classifyStudent({ ...base, progress: 90, finalAverage: 30 }), "Struggling");
  assert.strictEqual(classifyStudent({ ...base, progress: 80 }), "Top Performer");
  assert.strictEqual(classifyStudent({ ...base, progress: 20, courseAverage: 60 }), "Behind Average");
  // No classmates to compare against, so never "behind average".
  assert.strictEqual(classifyStudent({ ...base, progress: 20, courseAverage: 60, classmates: 1 }), "On Track");
  assert.strictEqual(classifyStudent({ ...base, progress: 50, finalAverage: 75 }), "On Track");
});

test("overallStatus — the most urgent course status wins", () => {
  assert.strictEqual(overallStatus([]), "Not Started");
  assert.strictEqual(overallStatus(["Not Started", "Not Started"]), "Not Started");
  assert.strictEqual(overallStatus(["Top Performer", "Struggling"]), "Struggling");
  assert.strictEqual(overallStatus(["Top Performer", "Behind Average"]), "Behind Average");
  assert.strictEqual(overallStatus(["Top Performer", "Not Started"]), "Top Performer");
  assert.strictEqual(overallStatus(["On Track", "Top Performer"]), "On Track");
});

test("treeStats counts items done, not whole modules", () => {
  const item = (id, completed, extra = {}) => ({ id, completed, visited: completed, ...extra });
  const hierarchy = {
    contents: [],
    quizzes: [],
    assignments: [],
    modules: [
      {
        title: "Module 1",
        contents: [],
        quizzes: [],
        assignments: [],
        lessons: [
          {
            contents: [],
            quizzes: [item("q1", true)],
            assignments: [],
            topics: [
              { contents: [item("c1", true), item("c2", false, { contentType: "ASSIGNMENT" })], quizzes: [], assignments: [] },
            ],
          },
          { contents: [item("c3", false)], quizzes: [], assignments: [item("a1", true)], topics: [] },
        ],
      },
      // A module with nothing in it is skipped, not shown at 0%.
      { title: "Empty", contents: [], quizzes: [], assignments: [], lessons: [] },
    ],
  };

  const stats = treeStats(hierarchy);

  // 3 of 5 items done — even though no whole module is finished.
  assert.strictEqual(stats.progress, 60);
  assert.strictEqual(stats.started, true);
  assert.deepStrictEqual(stats.modules, [{ title: "Module 1", progress: 60, status: "In Progress" }]);
  // Assignments: the lesson-composer block (c2, not done) and a1 (done).
  assert.strictEqual(stats.assignmentsTotal, 2);
  assert.strictEqual(stats.assignmentsDone, 1);

  const untouched = treeStats({ contents: [item("x", false)], quizzes: [], assignments: [], modules: [] });
  assert.strictEqual(untouched.started, false);
  assert.strictEqual(untouched.progress, 0);
});

test("recomputeCourseProgress with persist:false computes without writing", async () => {
  const noWrite = (name) => async () => {
    throw new Error(`${name} must not be called when persist is false`);
  };
  const course = {
    id: "c1",
    title: "Course",
    status: "PUBLISHED",
    contents: [],
    quizzes: [],
    assignments: [],
    modules: [
      {
        id: "m1",
        title: "Module",
        order: 1,
        contents: [],
        quizzes: [],
        assignments: [],
        lessons: [
          {
            id: "l1",
            title: "Lesson",
            order: 1,
            contents: [],
            quizzes: [],
            assignments: [],
            topics: [
              {
                id: "t1",
                title: "Topic",
                order: 1,
                contents: [
                  { id: "ct1", title: "Video", type: "VIDEO", order: 1, duration: null },
                  { id: "ct2", title: "Brief", type: "ASSIGNMENT", order: 2, duration: null },
                ],
                quizzes: [],
                assignments: [],
              },
            ],
          },
        ],
      },
    ],
  };

  // A fake client: reads answer from the fixture, every write throws.
  const client = {
    course: { findUnique: async () => course },
    contentProgress: {
      findMany: async () => [
        { contentId: "ct1", completed: true, completedAt: new Date(), visited: true, visitedAt: new Date() },
      ],
    },
    // Skip qualifications are read off the attempt log — a read, so it is
    // allowed here; this student has passed no qualifying test.
    quizAttempt: { findMany: async () => [] },
    topicProgress: { findMany: async () => [], upsert: noWrite("topicProgress.upsert") },
    lessonProgress: { findMany: async () => [], upsert: noWrite("lessonProgress.upsert") },
    moduleProgress: { findMany: async () => [], upsert: noWrite("moduleProgress.upsert") },
    enrollment: { findUnique: noWrite("enrollment.findUnique"), update: noWrite("enrollment.update") },
  };

  const result = await recomputeCourseProgress("s1", "c1", client, { includeTree: true, persist: false });

  // One of two topic items done: the topic (and so lesson/module/course) is
  // incomplete, but the student has clearly started.
  assert.strictEqual(result.completed, false);
  assert.strictEqual(result.visitedItems >= 0, true);
  const topic = result.hierarchy.modules[0].lessons[0].topics[0];
  assert.strictEqual(topic.progressPercent, 50);
  assert.deepStrictEqual(
    topic.contents.map((c) => [c.id, c.contentType, c.completed]),
    [
      ["ct1", "VIDEO", true],
      ["ct2", "ASSIGNMENT", false],
    ]
  );
});

// The directory rolls up every enrolled student of a course from ONE load of
// the tree and ONE query per table — a roll-up per (student, course) pair
// exhausted the connection pool (P2024) — and each student still gets only
// their own rows and qualifications.
test("computeCourseProgressForStudents — one query per table, results per student", async (t) => {
  const calls = {};
  const patched = [];
  const patch = (model, method, impl) => {
    const original = prisma[model][method];
    patched.push(() => (prisma[model][method] = original));
    prisma[model][method] = async (args) => {
      calls[`${model}.${method}`] = (calls[`${model}.${method}`] || 0) + 1;
      return impl(args);
    };
  };
  t.after(() => patched.forEach((restore) => restore()));

  const at = new Date("2026-01-01T00:00:00Z");
  const noWrite = (name) => () => {
    throw new Error(`${name} must not be called`);
  };
  patch("course", "findUnique", () => ({ id: "c1", title: "Course", status: "PUBLISHED", sequentialLearning: true }));
  patch("module", "findMany", () => [{ id: "m1", title: "Module", order: 1 }]);
  patch("lesson", "findMany", () => [{ id: "l1", title: "Lesson", order: 1, moduleId: "m1" }]);
  patch("topic", "findMany", () => [
    { id: "t1", title: "Topic 1", order: 1, lessonId: "l1" },
    { id: "t2", title: "Topic 2", order: 2, lessonId: "l1" },
  ]);
  patch("subTopic", "findMany", () => []);
  patch("concept", "findMany", () => []);
  patch("content", "findMany", () => [
    { id: "ct1", title: "Video", type: "VIDEO", order: 1, duration: null, topicId: "t1" },
    { id: "ct2", title: "Video", type: "VIDEO", order: 1, duration: null, topicId: "t2" },
  ]);
  patch("contentProgress", "findMany", () => [
    { studentId: "s1", contentId: "ct1", completed: true, completedAt: at, visited: true, visitedAt: at },
  ]);
  // s2 passed the qualifying test for topic 2 and has done nothing else.
  patch("quizAttempt", "findMany", () => [
    { studentId: "s2", submittedAt: at, quiz: { id: "qq", quizTag: "QUALIFYING", topicId: "t2", lessonId: "l1" } },
  ]);
  patch("topicProgress", "findMany", () => []);
  patch("lessonProgress", "findMany", () => []);
  patch("moduleProgress", "findMany", () => []);
  patch("topicProgress", "upsert", noWrite("topicProgress.upsert"));
  patch("enrollment", "findUnique", noWrite("enrollment.findUnique"));
  patch("enrollment", "update", noWrite("enrollment.update"));

  const results = await computeCourseProgressForStudents(["s1", "s2", "s3"], "c1", { includeTree: true });

  for (const [key, count] of Object.entries(calls)) assert.strictEqual(count, 1, `${key} ran ${count} times`);

  const topics = (id) => results.get(id).hierarchy.modules[0].lessons[0].topics;
  assert.deepStrictEqual(
    topics("s1").map((topic) => [topic.id, topic.completed, topic.qualified]),
    [["t1", true, false], ["t2", false, false]]
  );
  // Qualifying completes the skipped subtree; it stays marked as a skip.
  assert.deepStrictEqual(
    topics("s2").map((topic) => [topic.id, topic.completed, topic.qualified]),
    [["t1", false, false], ["t2", true, true]]
  );
  assert.strictEqual(results.get("s3").completedItems, 0);
  assert.strictEqual(results.get("s3").visitedItems, 0);
});
