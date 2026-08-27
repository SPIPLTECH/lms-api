const prisma = require("../../../../config/database");
const studentState = require("../../../student-state");

const learningGoalRepository = require("../../repositories/learningGoal.repository");

/** Student State's getFullState throws 404 when no state exists yet — a normal, not exceptional, case for a cross-agent reader. */
const tryGetLearningState = async (studentId) => {
  try {
    return await studentState.getFullState(studentId);
  } catch (error) {
    return null;
  }
};

/**
 * The AI Student Entry Phase's per-course baseline (getCourseState already
 * returns null rather than throwing when absent — normal until a student
 * completes that course's entry assessment).
 */
const tryGetCourseState = async (studentId, courseId) => {
  if (!courseId) return null;
  try {
    return await studentState.getCourseState(studentId, courseId);
  } catch (error) {
    return null;
  }
};

const fetchEnrollments = (studentId) =>
  prisma.enrollment.findMany({
    where: { studentId },
    include: { course: { select: { id: true, title: true, status: true } } },
    orderBy: { lastAccessedAt: "desc" },
  });

/** Published modules/lessons only, already ordered — Module.order/Lesson.order are this LMS's real sequencing/prerequisite mechanism. */
const fetchCourseStructure = (courseId) =>
  prisma.module.findMany({
    where: { courseId, isPublished: true },
    orderBy: { order: "asc" },
    include: {
      lessons: {
        where: { isPublished: true },
        orderBy: { order: "asc" },
        include: { topics: { include: { contents: { select: { duration: true } } } } },
      },
    },
  });

const fetchProgressForLessons = (studentId, lessonIds) => {
  if (lessonIds.length === 0) return Promise.resolve([]);
  return prisma.progress.findMany({ where: { studentId, lessonId: { in: lessonIds } }, select: { lessonId: true, completed: true } });
};

/**
 * Assembles one StudentContext by pulling from Student State (progress/
 * performance/engagement/behavior), the real course structure (Module ->
 * Lesson -> Content), real Progress rows, real Enrollment rows, and this
 * agent's own LearningGoal (if any exists for the current course). Never
 * writes to any of those — a pure aggregation read, same discipline as
 * every other agent's context builder.
 *
 * @param {string} studentId
 * @returns {Promise<import("../../types/learningPath.types").StudentContext>}
 */
const buildContext = async (studentId) => {
  const now = new Date();

  const [learningState, enrollments] = await Promise.all([tryGetLearningState(studentId), fetchEnrollments(studentId)]);

  const currentCourseId = learningState?.progress?.currentCourseId || enrollments[0]?.courseId || null;

  let courseStructure = null;
  let progressByLessonId = new Map();
  let activeGoal = null;
  let courseState = null;

  if (currentCourseId) {
    courseStructure = await fetchCourseStructure(currentCourseId);
    const lessonIds = courseStructure.flatMap((module) => module.lessons.map((lesson) => lesson.id));
    const progressRows = await fetchProgressForLessons(studentId, lessonIds);
    progressByLessonId = new Map(progressRows.map((row) => [row.lessonId, { completed: row.completed }]));
    activeGoal = await learningGoalRepository.findActiveByStudentAndCourse(studentId, currentCourseId);
    courseState = await tryGetCourseState(studentId, currentCourseId);
  }

  return {
    studentId,
    now,
    learningState,
    enrollments,
    currentCourseId,
    courseStructure,
    progressByLessonId,
    activeGoal,
    courseState,
  };
};

module.exports = { buildContext };
