const { MOTIVATION_ACTION_TYPE, MOTIVATION_PRIORITY, STREAK_STATUS } = require("../../../constants");

/**
 * LEARNING_STREAK_ALERT: fires on the moment a streak breaks (encourage
 * restarting) or while a live streak is AT_RISK today (protect it before
 * it breaks). Reads the pre-computed streakEvaluator result, not raw state
 * — see motivation.service.js, which evaluates the streak once per cycle
 * before running detectors.
 *
 * @param {import("../../../types/motivation.types").StudentContext} context
 * @param {ReturnType<import("../streakEvaluator").evaluateStreak>} streakEvaluation
 * @returns {import("../../../types/motivation.types").MotivationCandidate[]}
 */
const detect = (context, streakEvaluation) => {
  if (streakEvaluation.justBroken) {
    return [
      {
        type: MOTIVATION_ACTION_TYPE.LEARNING_STREAK_ALERT,
        dedupeKey: "broken",
        priority: MOTIVATION_PRIORITY.MEDIUM,
        triggerReason: `Your ${streakEvaluation.longestStreakDays > 0 ? "streak" : "learning streak"} broke — start a new one today, every streak starts at day one.`,
        confidence: 80,
        recommendedAt: context.now,
        metadata: { previousLongestStreakDays: streakEvaluation.longestStreakDays },
      },
    ];
  }

  if (streakEvaluation.streakStatus === STREAK_STATUS.AT_RISK) {
    return [
      {
        type: MOTIVATION_ACTION_TYPE.LEARNING_STREAK_ALERT,
        dedupeKey: "at-risk",
        priority: MOTIVATION_PRIORITY.HIGH,
        triggerReason: `Your ${streakEvaluation.currentStreakDays}-day streak is still alive — a quick session today keeps it going.`,
        confidence: 75,
        recommendedAt: context.now,
        metadata: { currentStreakDays: streakEvaluation.currentStreakDays },
      },
    ];
  }

  return [];
};

module.exports = { detect };
