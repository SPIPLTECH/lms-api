const { MOTIVATION_ACTION_TYPE, MOTIVATION_PRIORITY } = require("../../../constants");

/**
 * MILESTONE_CELEBRATION: two independent sources, both real —
 * (1) a StudentAchievement badge earned recently (this LMS's existing
 * achievements/XP system), and (2) a streak-day threshold just crossed
 * (7/14/30/... days, from streakEvaluator, each celebrated exactly once
 * via StudentStreak.celebratedStreakMilestones).
 *
 * @param {import("../../../types/motivation.types").StudentContext} context
 * @param {ReturnType<import("../streakEvaluator").evaluateStreak>} streakEvaluation
 * @returns {import("../../../types/motivation.types").MotivationCandidate[]}
 */
const detect = (context, streakEvaluation) => {
  const candidates = [];

  for (const record of context.recentAchievements || []) {
    candidates.push({
      type: MOTIVATION_ACTION_TYPE.MILESTONE_CELEBRATION,
      dedupeKey: `achievement:${record.achievementId}`,
      priority: MOTIVATION_PRIORITY.LOW,
      triggerReason: `You earned "${record.achievement.name}"!`,
      confidence: 95,
      recommendedAt: context.now,
      metadata: { achievementId: record.achievementId, xpReward: record.achievement.xpReward, earnedAt: record.earnedAt },
    });
  }

  for (const milestone of streakEvaluation.newlyCrossedMilestones) {
    candidates.push({
      type: MOTIVATION_ACTION_TYPE.MILESTONE_CELEBRATION,
      dedupeKey: `streak:${milestone}`,
      priority: MOTIVATION_PRIORITY.MEDIUM,
      triggerReason: `${milestone}-day learning streak — that's real consistency!`,
      confidence: 95,
      recommendedAt: context.now,
      metadata: { streakMilestoneDays: milestone },
    });
  }

  return candidates;
};

module.exports = { detect };
