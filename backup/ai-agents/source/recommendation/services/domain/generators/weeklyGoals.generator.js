const { RECOMMENDATION_TYPE, WEEKLY_GOAL_LESSON_TARGET } = require("../../../constants");
const { clamp, round2 } = require("../../../utils/scoreMath.util");

/**
 * WEEKLY_LEARNING_GOALS: a pace-based composite, not tied to any single
 * concept. Compares this week's study time/lesson pace (Student State's
 * engagement domain) against a baseline target, so it's meaningful even
 * for a student with zero assessment history.
 *
 * @param {import("../../../types/recommendation.types").StudentContext} context
 * @returns {import("../../../types/recommendation.types").Candidate[]}
 */
const generate = (context) => {
  const engagement = context.learningState?.engagement;
  const progress = context.learningState?.progress;
  if (!engagement && !progress) return [];

  const weeklyHours = round2((engagement?.weeklyStudyTimeSeconds || 0) / 3600);
  const lessonsCompleted = progress?.lessonsCompletedCount || 0;
  const paceRatio = WEEKLY_GOAL_LESSON_TARGET > 0 ? lessonsCompleted / WEEKLY_GOAL_LESSON_TARGET : 1;

  const behindPace = paceRatio < 0.6;

  return [
    {
      type: RECOMMENDATION_TYPE.WEEKLY_LEARNING_GOALS,
      dedupeKey: "weekly",
      reason: behindPace
        ? `You've completed ${lessonsCompleted} lesson(s) this cycle against a target of ${WEEKLY_GOAL_LESSON_TARGET} — a bit more pace keeps you on track.`
        : `You're on pace with ${lessonsCompleted} lesson(s) completed — keep the streak going.`,
      urgency: behindPace ? 45 : 15,
      impact: 40,
      confidence: 65,
      estimatedTimeMinutes: 60,
      metadata: {
        weeklyStudyHours: weeklyHours,
        lessonsCompleted,
        target: WEEKLY_GOAL_LESSON_TARGET,
        paceRatio: clamp(round2(paceRatio * 100)),
      },
    },
  ];
};

module.exports = { generate };
