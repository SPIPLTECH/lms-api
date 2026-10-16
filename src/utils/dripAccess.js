const prisma = require("../config/database");
const { recomputeCourseProgress } = require("./progressRollup");
const { getCourseQualifyingQuizzes } = require("./qualification");
const { buildLearningPath } = require("./learningPath");

// The lesson ids a student can actually see and complete for a course, in
// course order: published lessons within published modules only. A lesson
// can be individually published while its parent module is still a draft
// (e.g. an instructor still building out a module) — in that case the whole
// module is hidden from students by getCourseById, so it must not count
// toward totalLessons/percentage either, or completion math (and the 100%
// certificate check) would divide by a denominator the student can never
// actually reach.
const getPublishedLessonIds = async (courseId) => {
  const lessons = await prisma.lesson.findMany({
    where: { module: { courseId, isPublished: true }, isPublished: true },
    orderBy: [{ module: { order: "asc" } }, { order: "asc" }],
    select: { id: true },
  });
  return lessons.map((lesson) => lesson.id);
};

/**
 * Sequential lesson gating for the course endpoint.
 *
 * This used to be the drip-content gate. Drip was removed, the function was
 * left short-circuited open (`if (true) { ...everything unlocked }`), and what
 * remained read a `Progress` table that no longer exists — config/database.js
 * mocks it to return nothing, so the completion set was always empty too. It
 * is now the real sequential gate.
 *
 * It does not reimplement the rule. It asks learningPath.js, the same module
 * GET /progress/learning-path and the access check use, so the lesson the
 * course endpoint calls locked is the lesson every other part of the system
 * calls locked. That matters for the cases a hand-rolled version gets wrong:
 * a lesson with nothing trackable in it never blocks (matching the roll-up's
 * own rule that empty containers don't hold up a parent), and a lesson the
 * student qualified out of counts as settled just like a completed one.
 *
 * The roll-up runs read-only here — this is a GET, and reading a course must
 * not write progress rows or bump lastAccessedAt.
 *
 * Returns { lockMap, completedSet, qualifiedSet }: callers that need lock
 * state invariably also need which lessons are genuinely finished (to draw a
 * checkmark) and which were skipped after qualifying (to draw that
 * distinctly).
 */
const buildLessonLockMap = async (courseId, studentId) => {
  const lessonIds = await getPublishedLessonIds(courseId);

  const lockMap = new Map();
  const completedSet = new Set();
  const qualifiedSet = new Set();

  // Not a student, or nothing to gate.
  if (!studentId || lessonIds.length === 0) {
    lessonIds.forEach((lessonId) => lockMap.set(lessonId, false));
    return { lockMap, completedSet, qualifiedSet };
  }

  let path;
  try {
    const [rollup, qualifyingQuizzes] = await Promise.all([
      recomputeCourseProgress(studentId, courseId, null, { includeTree: true, persist: false }),
      getCourseQualifyingQuizzes(courseId),
    ]);
    path = buildLearningPath(rollup.hierarchy, qualifyingQuizzes);
  } catch {
    // Progress is advisory for rendering a course: if the roll-up can't be
    // computed, show the course rather than locking a student out of material
    // they may well have earned. The write paths (completeContent, and the
    // access assertion on the player) enforce the gate regardless.
    lessonIds.forEach((lessonId) => lockMap.set(lessonId, false));
    return { lockMap, completedSet, qualifiedSet };
  }

  const byLessonId = new Map(
    path.filter((entry) => entry.kind === "LESSON").map((entry) => [entry.id, entry])
  );

  for (const lessonId of lessonIds) {
    const entry = byLessonId.get(lessonId);
    lockMap.set(lessonId, entry?.locked === true);
    if (entry?.completed) completedSet.add(lessonId);
    if (entry?.qualified) qualifiedSet.add(lessonId);
  }

  return { lockMap, completedSet, qualifiedSet };
};

module.exports = { buildLessonLockMap, getPublishedLessonIds };
