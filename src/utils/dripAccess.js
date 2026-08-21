const prisma = require("../config/database");

// Sequential lesson gating for courses with dripContentEnabled: a lesson
// unlocks once the lesson immediately before it (course-wide order — module
// order, then lesson order) has been marked complete by this student. The
// first lesson in the course is always unlocked. When drip is off, every
// lesson is unlocked. Returns Map<lessonId, boolean locked>.
const buildLessonLockMap = async (courseId, studentId) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { dripContentEnabled: true },
  });

  const lessons = await prisma.lesson.findMany({
    where: { module: { courseId }, isPublished: true },
    orderBy: [{ module: { order: "asc" } }, { order: "asc" }],
    select: { id: true },
  });

  const lockMap = new Map();

  if (!course?.dripContentEnabled) {
    lessons.forEach((lesson) => lockMap.set(lesson.id, false));
    return lockMap;
  }

  const completedSet = new Set();
  if (studentId) {
    const completedRows = await prisma.progress.findMany({
      where: {
        studentId,
        lessonId: { in: lessons.map((lesson) => lesson.id) },
        completed: true,
      },
      select: { lessonId: true },
    });
    completedRows.forEach((row) => completedSet.add(row.lessonId));
  }

  let prevCompleted = true;
  for (const lesson of lessons) {
    lockMap.set(lesson.id, !prevCompleted);
    prevCompleted = completedSet.has(lesson.id);
  }

  return lockMap;
};

module.exports = { buildLessonLockMap };
