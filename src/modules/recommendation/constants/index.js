const { EVENT_TYPES } = require("../../observation");

const enums = require("./enums.constants");
const thresholds = require("./thresholds.constants");

/**
 * LearningEvent types this agent reacts to in real time. Deliberately a
 * small curated set — high-frequency micro-events (VIDEO_PROGRESS,
 * PAGE_VIEWED, QUIZ_QUESTION_ANSWERED, ...) would otherwise trigger a full
 * multi-agent context rebuild + candidate regeneration on every tick.
 */
const TRIGGER_EVENT_TYPES = Object.freeze([
  EVENT_TYPES.COURSE_ENROLLED,
  EVENT_TYPES.COURSE_COMPLETED,
  EVENT_TYPES.MODULE_COMPLETED,
  EVENT_TYPES.LESSON_COMPLETED,
  EVENT_TYPES.VIDEO_COMPLETED,
  EVENT_TYPES.READING_COMPLETED,
  EVENT_TYPES.QUIZ_COMPLETED,
  EVENT_TYPES.QUIZ_ABANDONED,
  EVENT_TYPES.ASSIGNMENT_SUBMITTED,
  EVENT_TYPES.ASSIGNMENT_RESUBMITTED,
  EVENT_TYPES.AI_HINT_REQUESTED,
  EVENT_TYPES.SESSION_EXPIRED,
]);

const { RECOMMENDATION_TYPE: TYPE } = enums;

/** Groupings used by GET /recommendations/learning and /recommendations/revision. */
const LEARNING_TYPES = Object.freeze([
  TYPE.CONTINUE_LEARNING,
  TYPE.WATCH_RECOMMENDED_VIDEO,
  TYPE.READ_RECOMMENDED_NOTES,
  TYPE.COMPLETE_SUGGESTED_ASSIGNMENT,
]);

const REVISION_TYPES = Object.freeze([
  TYPE.REVIEW_WEAK_TOPICS,
  TYPE.ATTEMPT_ADAPTIVE_QUIZ,
  TYPE.PRACTICE_CODING_CHALLENGE,
  TYPE.REVISE_BEFORE_DEADLINE,
]);

module.exports = {
  EVENT_TYPES,
  TRIGGER_EVENT_TYPES,
  LEARNING_TYPES,
  REVISION_TYPES,
  ...enums,
  ...thresholds,
};
