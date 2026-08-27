const { MOTIVATION_ACTION_TYPE: TYPE } = require("./enums.constants");

module.exports = Object.freeze({
  // Per-student debounce window for event-triggered recompute — several
  // triggers for the same student in quick succession collapse into one
  // detector pass instead of several.
  RECOMPUTE_DEBOUNCE_MS: 5000,

  // Inactivity thresholds, in days since engagement.lastActiveAt.
  INACTIVITY_MEDIUM_DAYS: 3,
  INACTIVITY_HIGH_DAYS: 7,

  // Streak-day milestones worth a MILESTONE_CELEBRATION, each celebrated once.
  STREAK_CELEBRATION_MILESTONES: [7, 14, 30, 60, 100, 365],
  // A streak is AT_RISK once the student hasn't been active today and it's
  // past their preferred learning hour, without being fully broken yet.
  STREAK_AT_RISK_GRACE_HOURS: 4,

  // Deadline-scan lookahead, same idea as Recommendation's deadline generator.
  DEADLINE_LOOKAHEAD_HOURS: 48,
  DEADLINE_URGENT_HOURS: 12,

  // Burnout heuristic: elevated effort signals + flat/declining performance.
  BURNOUT_QUIZ_RETRY_THRESHOLD: 3,
  BURNOUT_AI_HELP_THRESHOLD: 4,
  BURNOUT_DAILY_STUDY_SECONDS: 3 * 3600, // > 3h/day sustained effort

  // Weekly-goal pacing (independent of Recommendation's own copy of this idea).
  WEEKLY_GOAL_LESSON_TARGET: 5,
  WEEKLY_GOAL_BEHIND_PACE_RATIO: 0.5,

  // Milestone detection window: StudentAchievement rows earned within this
  // many hours are still "recent" enough to celebrate.
  MILESTONE_LOOKBACK_HOURS: 48,

  // Study-session nudge: below this daily study time, but not fully
  // inactive, suggests a short session rather than an inactivity alert.
  LOW_DAILY_STUDY_SECONDS: 600, // < 10 min/day

  // Context builder's bounded read of Observation's chronological log.
  RECENT_EVENTS_WINDOW: 100,

  // Trend detection over EngagementTrend snapshots (older-half vs newer-half mean).
  ENGAGEMENT_TREND_DELTA_POINTS: 5,
  ENGAGEMENT_TREND_WINDOW_DAYS: 7,

  // Default time-to-live per action type when no more specific expiry
  // (e.g. a real deadline) applies.
  DEFAULT_EXPIRY_HOURS: {
    [TYPE.DAILY_REMINDER]: 24,
    [TYPE.STUDY_SESSION_REMINDER]: 24,
    [TYPE.DEADLINE_ALERT]: 24,
    [TYPE.CONGRATULATIONS_MESSAGE]: 72,
    [TYPE.MILESTONE_CELEBRATION]: 72,
    [TYPE.WEEKLY_GOAL_REMINDER]: 168,
    [TYPE.REVISION_REMINDER]: 48,
    [TYPE.LEARNING_STREAK_ALERT]: 24,
    [TYPE.INACTIVITY_ALERT]: 168,
    [TYPE.PERSONALIZED_ENCOURAGEMENT]: 72,
    [TYPE.SMART_NUDGE]: 24,
  },

  // ReminderSchedule defaults for a newly-enrolled student with no
  // Student State behavior data yet (before a real preferredLearningHour exists).
  DEFAULT_PREFERRED_HOUR: 18,
});
