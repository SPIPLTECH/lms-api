const {
  HEALTH_WEIGHT_ENGAGEMENT,
  HEALTH_WEIGHT_PERFORMANCE,
  HEALTH_WEIGHT_COMPLETION,
  HEALTH_WEIGHT_RISK,
  INACTIVE_DAYS,
} = require("../../constants");
const { average, percent, clamp, round2, daysBetween } = require("../../utils/scoreMath.util");

/**
 * Class Engagement Score + Course Health Score (2 of the 14 output types)
 * from one composite calculation — course health is a weighted blend of
 * class-average engagement, class-average performance, lesson completion
 * rate, and the inverse of the at-risk percentage. Pure function: no I/O,
 * everything it needs is already in the context's batch-read student
 * states and lesson list.
 *
 * @param {import("../../types/teacherInsight.types").CourseContext} context
 * @param {number} atRiskCount - from atRiskStudents.detector's output length.
 * @returns {{courseHealthScore: number, classEngagementScore: number, classPerformanceScore: number, completionRate: number, atRiskStudentPercent: number, enrolledCount: number, activeStudentCount: number}}
 */
const calculateCourseHealth = (context, atRiskCount) => {
  const enrolledCount = context.enrolledCount;

  if (enrolledCount === 0 || context.studentStates.length === 0) {
    return {
      courseHealthScore: 0,
      classEngagementScore: 0,
      classPerformanceScore: 0,
      completionRate: 0,
      atRiskStudentPercent: 0,
      enrolledCount,
      activeStudentCount: 0,
    };
  }

  const classEngagementScore = round2(average(context.studentStates.map((s) => s.scores?.engagementScore || 0)));
  const classPerformanceScore = round2(average(context.studentStates.map((s) => s.scores?.performanceScore || 0)));

  const totalPossibleCompletions = (context.lessons?.length || 0) * enrolledCount;
  const totalActualCompletions = (context.lessons || []).reduce((sum, l) => sum + l.completedCount, 0);
  const completionRate = totalPossibleCompletions > 0 ? percent(totalActualCompletions, totalPossibleCompletions) : 0;

  const atRiskStudentPercent = percent(atRiskCount, enrolledCount);

  const courseHealthScore = clamp(
    round2(
      classEngagementScore * HEALTH_WEIGHT_ENGAGEMENT +
        classPerformanceScore * HEALTH_WEIGHT_PERFORMANCE +
        completionRate * HEALTH_WEIGHT_COMPLETION +
        (100 - atRiskStudentPercent) * HEALTH_WEIGHT_RISK
    )
  );

  const activeStudentCount = context.studentStates.filter(
    (s) => s.engagement?.lastActiveAt && daysBetween(context.now, new Date(s.engagement.lastActiveAt)) < INACTIVE_DAYS
  ).length;

  return {
    courseHealthScore,
    classEngagementScore,
    classPerformanceScore,
    completionRate,
    atRiskStudentPercent,
    enrolledCount,
    activeStudentCount,
  };
};

module.exports = { calculateCourseHealth };
