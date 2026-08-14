const { EVENT_TYPES } = require("../../observation");

const enums = require("./enums.constants");
const thresholds = require("./thresholds.constants");

/**
 * LearningEvent types this agent reacts to in real time, beyond the peer
 * agents' own update signals — covers the "Quiz Completed"/"Assignment
 * Submitted" business triggers directly, since freshness on those two
 * matters for quiz/assignment difficulty detection.
 */
const TRIGGER_EVENT_TYPES = Object.freeze([EVENT_TYPES.QUIZ_COMPLETED, EVENT_TYPES.ASSIGNMENT_SUBMITTED]);

module.exports = {
  EVENT_TYPES,
  TRIGGER_EVENT_TYPES,
  ...enums,
  ...thresholds,
};
