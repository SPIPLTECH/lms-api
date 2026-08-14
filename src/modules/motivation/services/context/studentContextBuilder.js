const prisma = require("../../../../config/database");
const observation = require("../../../observation");
const studentState = require("../../../student-state");
const assessment = require("../../../assessment");
const recommendation = require("../../../recommendation");
const streakRepository = require("../../repositories/studentStreak.repository");
const { RECENT_EVENTS_WINDOW, MILESTONE_LOOKBACK_HOURS } = require("../../constants");

/**
 * Learning Path Agent doesn't exist in this codebase yet. Defensive
 * try/require, same pattern used by Assessment and Recommendation — the
 * moment it exists with a getFullState(studentId)-shaped read, this starts
 * using it with no changes elsewhere.
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

/** Student State's getFullState throws 404 when no state exists yet — a normal, not exceptional, case for a cross-agent reader. */
const tryGetLearningState = async (studentId) => {
  try {
    return await studentState.getFullState(studentId);
  } catch (error) {
    return null;
  }
};

const fetchEnrolledCourseIds = async (studentId) => {
  const enrollments = await prisma.enrollment.findMany({ where: { studentId }, select: { courseId: true } });
  return enrollments.map((e) => e.courseId);
};

const fetchRecentAchievements = (studentId, now) => {
  const cutoff = new Date(now.getTime() - MILESTONE_LOOKBACK_HOURS * 3600 * 1000);
  return prisma.studentAchievement.findMany({
    where: { studentId, earnedAt: { gte: cutoff } },
    include: { achievement: true },
    orderBy: { earnedAt: "desc" },
  });
};

const fetchPendingAssignments = (studentId, courseIds) => {
  if (courseIds.length === 0) return [];
  return prisma.assignment.findMany({
    where: { courseId: { in: courseIds }, isPublished: true, submissions: { none: { studentId } } },
    orderBy: { dueDate: "asc" },
  });
};

const fetchPendingQuizzes = (studentId, courseIds) => {
  if (courseIds.length === 0) return [];
  return prisma.quiz.findMany({
    where: { courseId: { in: courseIds }, isPublished: true, dueDate: { not: null }, quizSubmissions: { none: { studentId } } },
    orderBy: { dueDate: "asc" },
  });
};

/**
 * Assembles one StudentContext by pulling from Student State, Assessment,
 * Recommendation, Observation, Learning Path (if present), this agent's own
 * StudentStreak row, and the read-only deadline/achievement catalog. Never
 * writes to any of those — a pure aggregation read.
 *
 * @param {string} studentId
 * @returns {Promise<import("../../types/motivation.types").StudentContext>}
 */
const buildContext = async (studentId) => {
  const now = new Date();

  const [learningState, assessmentState, recommendationState, recentEventsFull, streak, learningPath, courseIds] =
    await Promise.all([
      tryGetLearningState(studentId),
      assessment.getFullState(studentId),
      recommendation.getByStudent(studentId),
      observation.getStudentEventLog(studentId),
      streakRepository.findByStudent(studentId),
      tryGetLearningPathState(studentId),
      fetchEnrolledCourseIds(studentId),
    ]);

  const [recentAchievements, pendingAssignments, pendingQuizzes] = await Promise.all([
    fetchRecentAchievements(studentId, now),
    fetchPendingAssignments(studentId, courseIds),
    fetchPendingQuizzes(studentId, courseIds),
  ]);

  return {
    studentId,
    now,
    learningState,
    assessment: assessmentState,
    recommendation: recommendationState,
    recentEvents: recentEventsFull.slice(-RECENT_EVENTS_WINDOW),
    recentAchievements,
    pendingAssignments,
    pendingQuizzes,
    streak,
    learningPath,
  };
};

module.exports = { buildContext };
