/**
 * Channel names future agents (Learning Path, Assessment, Recommendation,
 * Motivation, Teacher Insight, Analytics, Career Guidance, Placement)
 * subscribe to for state changes, without depending on this module's
 * internals.
 */
const STUDENT_STATE_EVENT_NAMES = Object.freeze({
  STATE_UPDATED: "student-state:updated",
});

module.exports = { STUDENT_STATE_EVENT_NAMES };
