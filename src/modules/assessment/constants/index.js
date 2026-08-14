const { EVENT_TYPES } = require("../../observation");

const enums = require("./enums.constants");
const thresholds = require("./thresholds.constants");
const entryPhase = require("./entryPhase.constants");

/** LearningEvent types this agent treats as evaluative evidence of knowledge. */
const EVALUATIVE_EVENT_TYPES = Object.freeze([
  EVENT_TYPES.QUIZ_COMPLETED,
  EVENT_TYPES.ASSIGNMENT_SUBMITTED,
  EVENT_TYPES.ASSIGNMENT_RESUBMITTED,
  EVENT_TYPES.QUIZ_QUESTION_ANSWERED,
]);

module.exports = {
  EVENT_TYPES,
  EVALUATIVE_EVENT_TYPES,
  ...enums,
  ...thresholds,
  ...entryPhase,
};
