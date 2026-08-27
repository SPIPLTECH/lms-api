const { STREAK_STATUS, STREAK_CELEBRATION_MILESTONES, STREAK_AT_RISK_GRACE_HOURS } = require("../../constants");

const isSameUtcDate = (a, b) =>
  a && b && a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();

/**
 * Reconciles this agent's StudentStreak row against Student State's already-
 * computed consecutiveLearningDays — deliberately not re-deriving the
 * streak from raw events (Student State's engagement reducer already owns
 * that calculation); this only adds motivation-specific interpretation on
 * top: status classification and celebration-milestone bookkeeping.
 *
 * @param {Object} params
 * @param {number} params.consecutiveLearningDays - from Student State's engagement domain.
 * @param {number|null} params.preferredLearningHour - from Student State's behavior domain, 0-23 or null.
 * @param {{currentStreakDays: number, longestStreakDays: number, celebratedStreakMilestones: number[], lastBrokenAt: Date|null}|null} params.existingStreak
 * @param {Date} params.now
 * @returns {{currentStreakDays: number, longestStreakDays: number, streakStatus: string, lastActiveDate: Date, lastBrokenAt: Date|null, celebratedStreakMilestones: number[], justBroken: boolean, newlyCrossedMilestones: number[]}}
 */
const evaluateStreak = ({ consecutiveLearningDays, preferredLearningHour, existingStreak, now }) => {
  const previousStreakDays = existingStreak?.currentStreakDays || 0;
  const celebratedSoFar = existingStreak?.celebratedStreakMilestones || [];

  const justBroken = previousStreakDays > 0 && consecutiveLearningDays === 0;

  let streakStatus;
  if (consecutiveLearningDays === 0) {
    streakStatus = STREAK_STATUS.BROKEN;
  } else {
    const activeToday = isSameUtcDate(existingStreak?.lastActiveDate, now);
    const hour = preferredLearningHour ?? 18;
    const pastPreferredWindow = now.getUTCHours() >= hour + STREAK_AT_RISK_GRACE_HOURS;
    streakStatus = !activeToday && pastPreferredWindow ? STREAK_STATUS.AT_RISK : STREAK_STATUS.ACTIVE;
  }

  const newlyCrossedMilestones = STREAK_CELEBRATION_MILESTONES.filter(
    (milestone) => consecutiveLearningDays >= milestone && !celebratedSoFar.includes(milestone)
  );

  return {
    currentStreakDays: consecutiveLearningDays,
    longestStreakDays: Math.max(existingStreak?.longestStreakDays || 0, consecutiveLearningDays),
    streakStatus,
    lastActiveDate: consecutiveLearningDays > 0 ? now : existingStreak?.lastActiveDate || null,
    lastBrokenAt: justBroken ? now : existingStreak?.lastBrokenAt || null,
    celebratedStreakMilestones: [...celebratedSoFar, ...newlyCrossedMilestones],
    justBroken,
    newlyCrossedMilestones,
  };
};

module.exports = { evaluateStreak };
