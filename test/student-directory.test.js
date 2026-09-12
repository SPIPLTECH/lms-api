const test = require("node:test");
const assert = require("node:assert");

const { classifyStudent, overallStatus, treeStats } = require("../src/modules/students/student.service");
const { recomputeCourseProgress } = require("../src/utils/progressRollup");

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
