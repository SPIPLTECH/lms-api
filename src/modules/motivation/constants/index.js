const { EVENT_TYPES } = require("../../observation");

const enums = require("./enums.constants");
const thresholds = require("./thresholds.constants");

/**
 * LearningEvent types this agent treats as a genuine "moment" worth
 * reacting to on the next Student State recompute (used by
 * congratulations.detector.js to tell a real completion from routine
 * activity). Not a trigger allowlist itself — the real-time trigger is
 * Student State's aggregate update, debounced; this is a finer filter
 * applied to the recent-events slice once that fires.
 */
const CELEBRATION_EVENT_TYPES = Object.freeze([
  EVENT_TYPES.COURSE_COMPLETED,
  EVENT_TYPES.MODULE_COMPLETED,
  EVENT_TYPES.LESSON_COMPLETED,
  EVENT_TYPES.QUIZ_COMPLETED,
]);

module.exports = {
  EVENT_TYPES,
  CELEBRATION_EVENT_TYPES,
  ...enums,
  ...thresholds,
};
