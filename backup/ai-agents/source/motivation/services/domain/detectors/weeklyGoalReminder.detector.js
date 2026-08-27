const { MOTIVATION_ACTION_TYPE, MOTIVATION_PRIORITY, WEEKLY_GOAL_LESSON_TARGET, WEEKLY_GOAL_BEHIND_PACE_RATIO } = require("../../../constants");

/**
 * WEEKLY_GOAL_REMINDER: this LMS has no structured goal-tracking model, so
 * "learning goal missed" is realized as a pace check — lessons completed
 * this cycle against a baseline target — same idea as Recommendation's
 * weekly-goal candidate, computed independently here rather than reading
 * Recommendation's copy (this agent's own signal, own cadence).
 *
 * @param {import("../../../types/motivation.types").StudentContext} context
 * @returns {import("../../../types/motivation.types").MotivationCandidate[]}
 */
const detect = (context) => {
  const progress = context.learningState?.progress;
  if (!progress) return [];

  const lessonsCompleted = progress.lessonsCompletedCount || 0;
  const paceRatio = WEEKLY_GOAL_LESSON_TARGET > 0 ? lessonsCompleted / WEEKLY_GOAL_LESSON_TARGET : 1;

  if (paceRatio >= WEEKLY_GOAL_BEHIND_PACE_RATIO) return [];

  return [
    {
      type: MOTIVATION_ACTION_TYPE.WEEKLY_GOAL_REMINDER,
      dedupeKey: "weekly",
      priority: MOTIVATION_PRIORITY.MEDIUM,
      triggerReason: `You've completed ${lessonsCompleted} lesson(s) against a target of ${WEEKLY_GOAL_LESSON_TARGET} — there's still time to catch up.`,
      confidence: 65,
      recommendedAt: context.now,
      metadata: { lessonsCompleted, target: WEEKLY_GOAL_LESSON_TARGET, paceRatio },
    },
  ];
};

module.exports = { detect };
