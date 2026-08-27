const { COURSE_INSIGHT_TYPE, INSIGHT_PRIORITY, LOW_COMPLETION_RATE } = require("../../../constants");
const { percent } = require("../../../utils/scoreMath.util");

/**
 * LESSON_COMPLETION_TREND: only surfaces lessons whose completion rate is
 * at/below threshold — this doubles as "detect difficult lessons"
 * (RESPONSIBILITIES): a low completion rate IS the difficulty signal, not
 * a separate detector. Only meaningful once the course has enrollment.
 *
 * @param {import("../../../types/teacherInsight.types").CourseContext} context
 * @returns {import("../../../types/teacherInsight.types").CourseInsightCandidate[]}
 */
const detect = (context) => {
  if (context.enrolledCount === 0) return [];

  const candidates = [];
  for (const lesson of context.lessons || []) {
    const completionRate = percent(lesson.completedCount, context.enrolledCount);
    if (completionRate > LOW_COMPLETION_RATE) continue;

    candidates.push({
      insightType: COURSE_INSIGHT_TYPE.LESSON_COMPLETION_TREND,
      dedupeKey: lesson.id,
      priority: completionRate <= LOW_COMPLETION_RATE / 2 ? INSIGHT_PRIORITY.HIGH : INSIGHT_PRIORITY.MEDIUM,
      title: `"${lesson.title}" has a low completion rate`,
      reason: `${lesson.completedCount}/${context.enrolledCount} enrolled students (${completionRate}%) have completed it.`,
      confidence: 80,
      affectedStudentCount: context.enrolledCount - lesson.completedCount,
      lessonId: lesson.id,
      moduleId: lesson.moduleId,
      evidence: { completionRate, completedCount: lesson.completedCount, enrolledCount: context.enrolledCount },
    });
  }

  return candidates;
};

module.exports = { detect };
