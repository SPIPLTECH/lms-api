const prisma = require("../../../../../config/database");
const teacherInsights = require("../../../../teacher-insights");

const { METRIC_KEY } = require("../../../constants");
const { average, percent, round2 } = require("../../../utils/scoreMath.util");

/**
 * COURSE_PERFORMANCE/STUDENT_ENGAGEMENT reuse Teacher Insight's already-
 * computed CourseHealth per course (via its public getTeacherDashboard) —
 * Analytics never recomputes class health itself. TEACHING_EFFECTIVENESS/
 * ASSESSMENT_QUALITY have no owning agent, so those read the LMS's own
 * Lesson/Progress and Quiz/QuizSubmission tables directly, the same way
 * every other agent reads its own source-of-truth tables.
 *
 * @param {string} instructorId - User.id of the INSTRUCTOR.
 * @returns {Promise<import("../../../types/analytics.types").MetricRecord[]>}
 */
const calculateInstructorMetrics = async (instructorId) => {
  const courses = await prisma.course.findMany({ where: { creatorId: instructorId }, select: { id: true } });
  const courseIds = courses.map((c) => c.id);

  if (courseIds.length === 0) {
    return [
      { metricKey: METRIC_KEY.COURSE_PERFORMANCE, value: 0, unit: "score" },
      { metricKey: METRIC_KEY.STUDENT_ENGAGEMENT, value: 0, unit: "score" },
      { metricKey: METRIC_KEY.TEACHING_EFFECTIVENESS, value: 0, unit: "%" },
      { metricKey: METRIC_KEY.ASSESSMENT_QUALITY, value: 0, unit: "%" },
    ];
  }

  const [dashboard, lessons, quizzes] = await Promise.all([
    teacherInsights.getTeacherDashboard(instructorId),
    prisma.lesson.findMany({
      where: { module: { courseId: { in: courseIds } } },
      select: { id: true, progress: { select: { completed: true } } },
    }),
    prisma.quiz.findMany({
      where: { courseId: { in: courseIds } },
      select: { quizSubmissions: { select: { percentage: true, passed: true } } },
    }),
  ]);

  const healthScores = dashboard.courses.map((c) => c.courseHealth?.courseHealthScore).filter((v) => typeof v === "number");
  const engagementScores = dashboard.courses.map((c) => c.courseHealth?.classEngagementScore).filter((v) => typeof v === "number");

  const allProgress = lessons.flatMap((l) => l.progress);
  const teachingEffectiveness = percent(allProgress.filter((p) => p.completed).length, allProgress.length);

  const allSubmissions = quizzes.flatMap((q) => q.quizSubmissions);
  const assessmentQualityPassRate = percent(allSubmissions.filter((s) => s.passed).length, allSubmissions.length);

  return [
    {
      metricKey: METRIC_KEY.COURSE_PERFORMANCE,
      value: healthScores.length ? round2(average(healthScores)) : 0,
      unit: "score",
      metadata: { courseCount: courseIds.length },
    },
    {
      metricKey: METRIC_KEY.STUDENT_ENGAGEMENT,
      value: engagementScores.length ? round2(average(engagementScores)) : 0,
      unit: "score",
    },
    {
      metricKey: METRIC_KEY.TEACHING_EFFECTIVENESS,
      value: teachingEffectiveness,
      unit: "%",
      metadata: { lessonCount: lessons.length, completionEventCount: allProgress.length },
    },
    {
      metricKey: METRIC_KEY.ASSESSMENT_QUALITY,
      value: assessmentQualityPassRate,
      unit: "%",
      metadata: { submissionCount: allSubmissions.length },
    },
  ];
};

module.exports = { calculateInstructorMetrics };
