const prisma = require("../../../../../config/database");

const { METRIC_KEY, COURSE_INACTIVE_DAYS } = require("../../../constants");
const { average, percent, round2 } = require("../../../utils/scoreMath.util");

/**
 * No agent owns course-level enrollment/completion/dropout/score numbers,
 * so this reads the LMS's own Enrollment/LearningEvent/StudentActivityState/
 * QuizSubmission tables directly — the same source-of-truth reads every
 * other agent's own context builder already does for its domain.
 *
 * @param {string} courseId
 * @returns {Promise<import("../../../types/analytics.types").MetricRecord[]>}
 */
const calculateCourseMetrics = async (courseId) => {
  const enrollments = await prisma.enrollment.findMany({ where: { courseId }, select: { studentId: true, enrolledAt: true } });
  const studentIds = enrollments.map((e) => e.studentId);
  const enrolledCount = studentIds.length;

  if (enrolledCount === 0) {
    return [
      { metricKey: METRIC_KEY.ENROLLMENT_TREND, value: 0, unit: "count" },
      { metricKey: METRIC_KEY.COMPLETION_TREND, value: 0, unit: "%" },
      { metricKey: METRIC_KEY.DROPOUT_RATE, value: 0, unit: "%" },
      { metricKey: METRIC_KEY.AVERAGE_SCORE, value: 0, unit: "%" },
      { metricKey: METRIC_KEY.DIFFICULTY_SCORE, value: 0, unit: "score" },
    ];
  }

  const inactiveSince = new Date(Date.now() - COURSE_INACTIVE_DAYS * 24 * 3600 * 1000);

  const [completedCount, activityStates, quizzes] = await Promise.all([
    prisma.learningEvent.groupBy({
      by: ["studentId"],
      where: { courseId, eventType: "COURSE_COMPLETED", studentId: { in: studentIds } },
    }),
    prisma.studentActivityState.findMany({
      where: { studentId: { in: studentIds } },
      select: { studentId: true, lastActiveAt: true },
    }),
    prisma.quiz.findMany({
      where: { courseId },
      select: { passingScore: true, quizSubmissions: { select: { percentage: true, passed: true } } },
    }),
  ]);

  const activityByStudent = new Map(activityStates.map((a) => [a.studentId, a.lastActiveAt]));
  const inactiveCount = studentIds.filter((id) => {
    const lastActiveAt = activityByStudent.get(id);
    return !lastActiveAt || lastActiveAt < inactiveSince;
  }).length;

  const allSubmissions = quizzes.flatMap((q) => q.quizSubmissions);
  const avgScore = allSubmissions.length ? round2(average(allSubmissions.map((s) => s.percentage))) : 0;
  const passRate = percent(allSubmissions.filter((s) => s.passed).length, allSubmissions.length);
  // Difficulty as a proxy — how far the average learner falls short of "easy" (a high, comfortable pass rate) — same style of proxy Teacher Insight's difficulty detectors already use, since grades are otherwise free-text in this LMS.
  const difficultyScore = allSubmissions.length ? round2(100 - passRate) : 0;

  return [
    { metricKey: METRIC_KEY.ENROLLMENT_TREND, value: enrolledCount, unit: "count" },
    {
      metricKey: METRIC_KEY.COMPLETION_TREND,
      value: percent(completedCount.length, enrolledCount),
      unit: "%",
      metadata: { completedCount: completedCount.length, enrolledCount },
    },
    {
      metricKey: METRIC_KEY.DROPOUT_RATE,
      value: percent(inactiveCount, enrolledCount),
      unit: "%",
      metadata: { inactiveCount, inactiveThresholdDays: COURSE_INACTIVE_DAYS },
    },
    { metricKey: METRIC_KEY.AVERAGE_SCORE, value: avgScore, unit: "%", metadata: { submissionCount: allSubmissions.length } },
    { metricKey: METRIC_KEY.DIFFICULTY_SCORE, value: difficultyScore, unit: "score", metadata: { passRate } },
  ];
};

module.exports = { calculateCourseMetrics };
