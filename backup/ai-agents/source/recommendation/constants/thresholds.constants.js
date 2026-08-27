const { RECOMMENDATION_TYPE: TYPE } = require("./enums.constants");

module.exports = Object.freeze({
  // score = urgency * URGENCY_WEIGHT + impact * IMPACT_WEIGHT (both 0-100 inputs).
  URGENCY_WEIGHT: 0.6,
  IMPACT_WEIGHT: 0.4,

  // score -> priority bucket boundaries (0-100).
  PRIORITY_HIGH_THRESHOLD: 70,
  PRIORITY_MEDIUM_THRESHOLD: 40,

  // Hard cap on ACTIVE recommendations kept per student after ranking —
  // keeps the "today" surface small and decisive rather than overwhelming.
  MAX_ACTIVE_RECOMMENDATIONS: 15,

  // Per-student debounce window for event-triggered recompute: several
  // observed events for the same student in quick succession collapse
  // into a single recompute instead of one per event.
  RECOMPUTE_DEBOUNCE_MS: 5000,

  // Default time-to-live per recommendation type when no more specific
  // expiry (e.g. an actual deadline) applies.
  DEFAULT_EXPIRY_HOURS: {
    [TYPE.CONTINUE_LEARNING]: 72,
    [TYPE.REVIEW_WEAK_TOPICS]: 168,
    [TYPE.ATTEMPT_ADAPTIVE_QUIZ]: 168,
    [TYPE.WATCH_RECOMMENDED_VIDEO]: 72,
    [TYPE.READ_RECOMMENDED_NOTES]: 72,
    [TYPE.COMPLETE_SUGGESTED_ASSIGNMENT]: 72,
    [TYPE.PRACTICE_CODING_CHALLENGE]: 168,
    [TYPE.JOIN_DISCUSSION]: 72,
    [TYPE.ASK_AI_TUTOR]: 48,
    [TYPE.REVISE_BEFORE_DEADLINE]: 24,
    [TYPE.DAILY_LEARNING_TASKS]: 24,
    [TYPE.WEEKLY_LEARNING_GOALS]: 168,
  },

  // Deadline-scan lookahead: only surface REVISE_BEFORE_DEADLINE within
  // this many hours of a real Quiz/Assignment dueDate.
  DEADLINE_LOOKAHEAD_HOURS: 72,
  DEADLINE_URGENT_HOURS: 24, // inside this window, urgency maxes out

  // Engagement-derived thresholds.
  LOW_ENGAGEMENT_DAILY_SECONDS: 300, // < 5 min/day counts as low engagement
  INACTIVITY_NUDGE_DAYS: 2,
  STRUGGLE_QUIZ_RETRY_THRESHOLD: 2, // repeated retries on the same quiz -> nudge AI tutor
  LOW_AI_CHAT_USAGE_HELP_REQUESTS: 3, // >= this many hint requests with low chat usage -> nudge

  // Feedback-adjustment damping: how much repeated negative feedback on a
  // (student, type) pair suppresses that type's future score. Heuristic,
  // not a trained model — see feedbackAdjustment.js.
  FEEDBACK_DAMPING_PER_NEGATIVE: 0.12,
  FEEDBACK_MAX_DAMPING: 0.6,
  FEEDBACK_BOOST_PER_POSITIVE: 0.05,
  FEEDBACK_MAX_BOOST: 0.25,
  FEEDBACK_LOOKBACK_LIMIT: 20, // most recent feedback rows per (student, type) considered

  // Study-schedule composites.
  DAILY_TASKS_MAX_ITEMS: 3,
  WEEKLY_GOAL_LESSON_TARGET: 5, // baseline weekly lesson-completion goal when no history exists

  // Context builder reads Observation's full chronological log (same trusted
  // read Student State uses for recalculate) then keeps only the tail —
  // recommendation generation only needs recent signal, not full history.
  RECENT_EVENTS_WINDOW: 100,
  DISCUSSION_LOOKBACK_DAYS: 14,
});
