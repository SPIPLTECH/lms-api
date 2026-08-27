const prisma = require("../../../../config/database");
const studentState = require("../../../student-state");
const assessment = require("../../../assessment");
const recommendation = require("../../../recommendation");
const motivation = require("../../../motivation");

/**
 * Learning Path Agent doesn't exist in this codebase yet, and even once
 * built it'll be per-student like every other producer here — so this
 * defensively tries the same batch-read shape the other four already
 * expose, rather than a single course-level read that wouldn't fit its
 * actual (per-student) domain.
 */
const tryGetBatchLearningPathStates = async (studentIds) => {
  let learningPath;
  try {
    learningPath = require("../../../learning-path");
  } catch (error) {
    return [];
  }

  if (!learningPath || typeof learningPath.getBatchStates !== "function") return [];

  try {
    return await learningPath.getBatchStates(studentIds);
  } catch (error) {
    return [];
  }
};

const fetchCourse = (courseId) =>
  prisma.course.findUnique({ where: { id: courseId }, select: { id: true, title: true, category: true, creatorId: true } });

const fetchEnrolledStudentIds = async (courseId) => {
  const enrollments = await prisma.enrollment.findMany({ where: { courseId }, select: { studentId: true } });
  return enrollments.map((e) => e.studentId);
};

/** Lessons with a completion count derived directly from Progress — the real source of "who finished this lesson," not a copy. */
const fetchLessonsWithCompletion = (courseId) =>
  prisma.lesson.findMany({
    where: { module: { courseId } },
    select: {
      id: true,
      title: true,
      moduleId: true,
      order: true,
      progress: { where: { completed: true }, select: { studentId: true } },
    },
  });

/** Quizzes with their real QuizSubmission stats — average percentage, pass rate, submission count. */
const fetchQuizzesWithSubmissions = (courseId) =>
  prisma.quiz.findMany({
    where: { courseId },
    select: {
      id: true,
      title: true,
      passingScore: true,
      quizSubmissions: { select: { percentage: true, passed: true } },
    },
  });

/** Assignments with real submission counts — grades are free-text in this LMS (see AssignmentSubmission.grade), so submission/on-time rate is the difficulty signal, not average score. */
const fetchAssignmentsWithSubmissions = (courseId) =>
  prisma.assignment.findMany({
    where: { courseId },
    select: {
      id: true,
      title: true,
      dueDate: true,
      submissions: { select: { studentId: true, submittedAt: true } },
    },
  });

/**
 * Assembles one CourseContext by batch-reading every enrolled student's
 * Student State/Assessment/Recommendation/Motivation data (one query per
 * producer, not one per student) plus the course's own real structure and
 * submission data. Never writes to any of those — a pure aggregation read.
 *
 * @param {string} courseId
 * @returns {Promise<import("../../types/teacherInsight.types").CourseContext>}
 */
const buildContext = async (courseId) => {
  const now = new Date();

  const course = await fetchCourse(courseId);
  const studentIds = await fetchEnrolledStudentIds(courseId);

  const [studentStates, assessmentSummary, activeRecommendations, motivationSummary, learningPathStates, lessons, quizzes, assignments] =
    await Promise.all([
      studentState.getBatchStates(studentIds),
      assessment.getBatchAssessmentSummary(studentIds),
      recommendation.getBatchActiveRecommendations(studentIds),
      motivation.getBatchMotivationSummary(studentIds),
      tryGetBatchLearningPathStates(studentIds),
      fetchLessonsWithCompletion(courseId),
      fetchQuizzesWithSubmissions(courseId),
      fetchAssignmentsWithSubmissions(courseId),
    ]);

  return {
    courseId,
    course,
    studentIds,
    enrolledCount: studentIds.length,
    studentStates,
    assessmentSummary,
    activeRecommendations,
    motivationSummary,
    learningPathStates,
    lessons: lessons.map((l) => ({ ...l, completedCount: l.progress.length })),
    quizzes: quizzes.map((q) => {
      const submissions = q.quizSubmissions;
      return {
        id: q.id,
        title: q.title,
        submissionCount: submissions.length,
        avgPercentage: submissions.length ? submissions.reduce((s, r) => s + r.percentage, 0) / submissions.length : 0,
        passRate: submissions.length ? (submissions.filter((r) => r.passed).length / submissions.length) * 100 : 0,
      };
    }),
    assignments: assignments.map((a) => ({
      id: a.id,
      title: a.title,
      dueDate: a.dueDate,
      submissionCount: a.submissions.length,
      onTimeCount: a.submissions.filter((s) => !a.dueDate || s.submittedAt <= a.dueDate).length,
    })),
    now,
  };
};

module.exports = { buildContext };
