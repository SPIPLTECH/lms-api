const prisma = require("../../../../config/database");
const observation = require("../../../observation");
const studentState = require("../../../student-state");
const assessment = require("../../../assessment");
const { RECENT_EVENTS_WINDOW } = require("../../constants");

/**
 * Learning Path Agent doesn't exist in this codebase yet. Defensive
 * try/require, same pattern as Assessment's event consumer — the moment it
 * exists with a getFullState(studentId)-shaped read, this starts using it
 * with no changes elsewhere.
 */
const tryGetLearningPathState = async (studentId) => {
  let learningPath;
  try {
    learningPath = require("../../../learning-path");
  } catch (error) {
    return null;
  }

  if (!learningPath || typeof learningPath.getFullState !== "function") return null;

  try {
    return await learningPath.getFullState(studentId);
  } catch (error) {
    return null;
  }
};

/** Student State's getFullState throws 404 when no state exists yet — that's a normal, not exceptional, case for a cross-agent reader. */
const tryGetLearningState = async (studentId) => {
  try {
    return await studentState.getFullState(studentId);
  } catch (error) {
    return null;
  }
};

const fetchEnrollments = (studentId) =>
  prisma.enrollment.findMany({
    where: { studentId },
    include: { course: { select: { id: true, title: true, category: true, status: true } } },
  });

const fetchCurrentLessonContents = async (lessonId) => {
  if (!lessonId) return [];
  return prisma.content.findMany({ where: { lessonId }, orderBy: { order: "asc" } });
};

/**
 * Pending = published, belongs to a course the student is enrolled in, has
 * a dueDate, and the student has no submission for it yet. No hard FK from
 * Recommendation into Assignment/Quiz — this is a read-only join done here,
 * never persisted as a relation.
 */
const fetchPendingAssignments = async (studentId, courseIds) => {
  if (courseIds.length === 0) return [];

  return prisma.assignment.findMany({
    where: {
      courseId: { in: courseIds },
      isPublished: true,
      submissions: { none: { studentId } },
    },
    orderBy: { dueDate: "asc" },
  });
};

const fetchPendingQuizzes = async (studentId, courseIds) => {
  if (courseIds.length === 0) return [];

  return prisma.quiz.findMany({
    where: {
      courseId: { in: courseIds },
      isPublished: true,
      dueDate: { not: null },
      quizSubmissions: { none: { studentId } },
    },
    orderBy: { dueDate: "asc" },
  });
};

/**
 * Assembles one StudentContext by pulling from Student State, Assessment,
 * Observation, Learning Path (if present) and the read-only course catalog.
 * This module never writes to any of those — it's a pure aggregation read.
 *
 * @param {string} studentId
 * @returns {Promise<import("../../types/recommendation.types").StudentContext>}
 */
const buildContext = async (studentId) => {
  const now = new Date();

  const [
    learningState,
    assessmentState,
    profile,
    enrollments,
    recentEventsFull,
    learningPath,
  ] = await Promise.all([
    tryGetLearningState(studentId),
    assessment.getFullState(studentId),
    prisma.studentProfile.findUnique({ where: { id: studentId }, select: { learningGoals: true } }),
    fetchEnrollments(studentId),
    observation.getStudentEventLog(studentId),
    tryGetLearningPathState(studentId),
  ]);

  const courseIds = enrollments.map((e) => e.courseId);
  const currentLessonId = learningState?.progress?.currentLessonId || null;

  const [currentLessonContents, pendingAssignments, pendingQuizzes] = await Promise.all([
    fetchCurrentLessonContents(currentLessonId),
    fetchPendingAssignments(studentId, courseIds),
    fetchPendingQuizzes(studentId, courseIds),
  ]);

  return {
    studentId,
    now,
    learningState,
    assessment: assessmentState,
    enrollments,
    recentEvents: recentEventsFull.slice(-RECENT_EVENTS_WINDOW),
    currentLessonContents,
    pendingAssignments,
    pendingQuizzes,
    learningGoals: profile?.learningGoals || "",
    learningPath,
  };
};

module.exports = { buildContext };
