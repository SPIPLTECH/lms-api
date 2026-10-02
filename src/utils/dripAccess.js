const prisma = require("../config/database");
const { flattenContainers } = require("./learningSequence");

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
 * It does not reimplement the rule. It reads the learning sequence
 * (utils/learningSequence.js) — the same steps the player walks, the learning
 * path reports and every item endpoint enforces — so the lesson the course
 * endpoint calls locked is the lesson every other part of the system calls
 * locked: a lesson is locked when its first step is. A lesson with nothing
 * trackable in it never blocks, and a lesson the student qualified out of
 * counts as settled just like a completed one.
 *
 * The roll-up runs read-only here — this is a GET, and reading a course must
 * not write progress rows or bump lastAccessedAt.
 *
 * Returns { lockMap, completedSet, qualifiedSet, lockedContentIds }: lock
 * state per lesson, which lessons are finished / skipped after qualifying,
 * and every Content row whose material must be withheld.
 */
const buildLessonLockMap = async (courseId, studentId) => {
  const lessonIds = await getPublishedLessonIds(courseId);

  const lockMap = new Map();
  const completedSet = new Set();
  const qualifiedSet = new Set();
  // Every Content row (ordinary content, quiz and assignment items alike) the
  // student may not open yet, so the course endpoint can withhold its material.
  const lockedContentIds = new Set();

  // Not a student, or nothing to gate.
  if (!studentId || lessonIds.length === 0) {
    lessonIds.forEach((lessonId) => lockMap.set(lessonId, false));
    return { lockMap, completedSet, qualifiedSet, lockedContentIds };
  }

  let sequence;
  try {
    // The learning sequence the player walks and the API enforces; read-only.
    // Required lazily: progress.service sits above this module.
    ({ sequence } = await require("../modules/progress/progress.service").computeStudentSequence(studentId, courseId));
  } catch {
    // Progress is advisory for rendering a course: if it can't be computed,
    // show the course rather than locking a student out of material they may
    // well have earned. Every write path and every item endpoint enforces the
    // gate regardless.
    lessonIds.forEach((lessonId) => lockMap.set(lessonId, false));
    return { lockMap, completedSet, qualifiedSet, lockedContentIds };
  }

  const nodeById = new Map(flattenContainers(sequence.tree).map((node) => [node.id, node]));
  for (const lessonId of lessonIds) {
    const node = nodeById.get(lessonId);
    lockMap.set(lessonId, node?.locked === true);
    if (node?.completed) completedSet.add(lessonId);
    if (node?.qualified) qualifiedSet.add(lessonId);
  }
  for (const step of sequence.steps) {
    if (step.locked) step.contentIds.forEach((id) => lockedContentIds.add(id));
  }

  return { lockMap, completedSet, qualifiedSet, lockedContentIds };
};

module.exports = { buildLessonLockMap, getPublishedLessonIds };
