const { RECOMMENDATION_TYPE } = require("../../../constants");
const { clamp, round2 } = require("../../../utils/scoreMath.util");

const HOURS_PER_DAY = 24;

/**
 * "Pick up where you left off" — the single most basic recommendation:
 * the student has an in-progress course (Student State's currentCourseId)
 * that isn't complete yet. Urgency rises with days since last activity
 * (long-idle progress is more at risk of being abandoned); impact rises
 * with how close the course already is to completion (more sunk progress
 * worth protecting).
 *
 * @param {import("../../../types/recommendation.types").StudentContext} context
 * @returns {import("../../../types/recommendation.types").Candidate[]}
 */
const generate = (context) => {
  const progress = context.learningState?.progress;
  if (!progress?.currentCourseId) return [];
  if (progress.courseCompletionPercent >= 100) return [];

  const lastActiveAt = context.learningState?.engagement?.lastActiveAt;
  const daysIdle = lastActiveAt ? (context.now.getTime() - new Date(lastActiveAt).getTime()) / (HOURS_PER_DAY * 3600 * 1000) : 0;

  const urgency = clamp(round2(20 + daysIdle * 8)); // grows the longer they've been away
  const impact = clamp(round2(progress.courseCompletionPercent * 0.8 + 20)); // even early progress has a floor

  return [
    {
      type: RECOMMENDATION_TYPE.CONTINUE_LEARNING,
      dedupeKey: progress.currentCourseId,
      reason: `You're ${Math.round(progress.courseCompletionPercent)}% through this course — pick up where you left off.`,
      urgency,
      impact,
      confidence: 90,
      estimatedTimeMinutes: 20,
      courseId: progress.currentCourseId,
      moduleId: progress.currentModuleId || undefined,
      lessonId: progress.currentLessonId || undefined,
      metadata: { courseCompletionPercent: progress.courseCompletionPercent, daysIdle: round2(daysIdle) },
    },
  ];
};

module.exports = { generate };
