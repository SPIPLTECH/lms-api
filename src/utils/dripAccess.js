const prisma = require("../config/database");

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

// Sequential lesson gating for courses with dripContentEnabled: a lesson
// unlocks once the lesson immediately before it (course-wide order — module
// order, then lesson order) has been marked complete by this student. The
// first lesson in the course is always unlocked. When drip is off, every
// lesson is unlocked. Returns { lockMap: Map<lessonId, boolean locked>,
// completedSet: Set<lessonId> } — completedSet is exposed alongside the lock
// map because every caller that needs lock state also needs to know which
// lessons are actually complete (e.g. to render a completion checkmark),
// and this is already the one place in the codebase computing that set.
const buildLessonLockMap = async (courseId, studentId) => {
  // The course lookup that stood here selected only dripContentEnabled. With
  // that column gone the select was left empty, which Prisma rejects at
  // runtime — so every caller of this (GET /courses/:id among them) answered
  // 500 and the student course page reported "Course not found". Nothing read
  // the result: the drip branch below is already short-circuited, so the query
  // is simply removed rather than given something arbitrary to select.
  const lessonIds = await getPublishedLessonIds(courseId);

  const completedSet = new Set();
  if (studentId) {
    const completedRows = await prisma.progress.findMany({
      where: {
        studentId,
        lessonId: { in: lessonIds },
        completed: true,
      },
      select: { lessonId: true },
    });
    completedRows.forEach((row) => completedSet.add(row.lessonId));
  }

  const lockMap = new Map();

  if (true) { // drip content removed
    lessonIds.forEach((lessonId) => lockMap.set(lessonId, false));
    return { lockMap, completedSet };
  }

  let prevCompleted = true;
  for (const lessonId of lessonIds) {
    lockMap.set(lessonId, !prevCompleted);
    prevCompleted = completedSet.has(lessonId);
  }

  return { lockMap, completedSet };
};

module.exports = { buildLessonLockMap, getPublishedLessonIds };
