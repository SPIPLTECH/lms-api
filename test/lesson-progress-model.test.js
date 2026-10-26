const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const { buildLessonLockMap } = require("../src/utils/dripAccess");

// The `Progress` model was split into per-entity progress models
// (LessonProgress/ContentProgress/...), but several call sites kept querying
// `prisma.progress`, which no longer exists. A Proxy in config/database.js
// made those calls resolve to empty results instead of throwing, so lesson
// completion silently read as "nothing is ever completed" everywhere these
// call sites feed: student-facing lesson checkmarks, the instructor roster's
// per-student progress, and the course-level completion rate.

test("buildLessonLockMap reports lessons the student actually completed", async (t) => {
  const originals = {
    lessonFindMany: prisma.lesson.findMany,
    lessonProgressFindMany: prisma.lessonProgress.findMany,
  };
  t.after(() => {
    prisma.lesson.findMany = originals.lessonFindMany;
    prisma.lessonProgress.findMany = originals.lessonProgressFindMany;
  });

  prisma.lesson.findMany = async () => [{ id: "l1" }, { id: "l2" }];
  prisma.lessonProgress.findMany = async () => [{ lessonId: "l1" }];

  const { completedSet } = await buildLessonLockMap("c1", "s1");

  assert.strictEqual(completedSet.has("l1"), true, "completed lesson must be in completedSet");
  assert.strictEqual(completedSet.has("l2"), false, "incomplete lesson must not be in completedSet");
});

