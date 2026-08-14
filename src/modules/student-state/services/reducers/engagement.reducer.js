const { EVENT_TYPES } = require("../../constants");
const { getNumber } = require("../../utils/eventPayload.util");
const { round2, safeDivide } = require("../../utils/scoreMath.util");
const {
  startOfUtcDay,
  startOfUtcWeek,
  isSameUtcDay,
  isSameUtcWeek,
  rollStreak,
} = require("../../utils/time.util");

/**
 * Rolls daily/weekly study-time buckets forward if `now` has crossed into a
 * new UTC day/week since the last event. Every event passes through this
 * before any time is added, so buckets never silently carry stale totals.
 */
const rollTimeBuckets = (engagement, now) => {
  const next = { ...engagement };

  if (!engagement.dailyBucketDate || !isSameUtcDay(engagement.dailyBucketDate, now)) {
    next.dailyStudyTimeSeconds = 0;
    next.dailyBucketDate = startOfUtcDay(now);
  }

  if (!engagement.weeklyBucketStart || !isSameUtcWeek(engagement.weeklyBucketStart, now)) {
    next.weeklyStudyTimeSeconds = 0;
    next.weeklyBucketStart = startOfUtcWeek(now);
  }

  return next;
};

/**
 * Finalizes the in-progress session if this event belongs to a different
 * session than the one currently open, and opens a new one.
 */
const rollSession = (engagement, event, now) => {
  if (engagement.currentSessionId === event.sessionId) {
    return engagement; // still within the same session
  }

  const next = { ...engagement };
  const hadOpenSession = Boolean(engagement.currentSessionId && engagement.currentSessionStartedAt);

  if (hadOpenSession) {
    const referencePoint = engagement.lastActiveAt || engagement.currentSessionStartedAt;
    const durationSeconds = Math.max(
      0,
      Math.round((new Date(referencePoint).getTime() - new Date(engagement.currentSessionStartedAt).getTime()) / 1000)
    );

    next.totalSessionDurationSeconds = engagement.totalSessionDurationSeconds + durationSeconds;
    const completedSessions = engagement.sessionCount; // the session just closed is already counted
    next.averageSessionDurationSeconds = round2(
      safeDivide(next.totalSessionDurationSeconds, completedSessions)
    );
  }

  next.sessionCount = engagement.sessionCount + 1;
  next.currentSessionId = event.sessionId;
  next.currentSessionStartedAt = now;

  return next;
};

/**
 * @param {import("../../types/studentState.types").EngagementState} engagement
 * @param {object} event
 * @returns {import("../../types/studentState.types").EngagementState}
 */
const reduceEngagement = (engagement, event) => {
  const now = event.createdAt;

  let next = rollTimeBuckets(engagement, now);
  next = rollSession(next, event, now);

  const durationSeconds = getNumber(event.payload, "durationSeconds");
  if (durationSeconds !== null && durationSeconds > 0) {
    next.dailyStudyTimeSeconds += durationSeconds;
    next.weeklyStudyTimeSeconds += durationSeconds;
    next.totalStudyTimeSeconds += durationSeconds;
  }

  next.consecutiveLearningDays = rollStreak(engagement.lastActiveDate, now, engagement.consecutiveLearningDays);
  next.lastActiveDate = now;
  next.lastActiveAt = now;

  if (event.eventType === EVENT_TYPES.USER_LOGIN) {
    next.loginStreakDays = rollStreak(engagement.lastLoginDate, now, engagement.loginStreakDays);
    next.lastLoginDate = now;
    next.longestLoginStreakDays = Math.max(engagement.longestLoginStreakDays, next.loginStreakDays);
  }

  return next;
};

module.exports = { reduceEngagement, rollTimeBuckets, rollSession };
