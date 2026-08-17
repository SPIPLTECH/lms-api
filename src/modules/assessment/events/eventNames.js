/**
 * Channel names future agents (Recommendation, Motivation, Teacher
 * Insight, Analytics, Career Guidance, Placement) subscribe to.
 */
const ASSESSMENT_EVENT_NAMES = Object.freeze({
  ASSESSMENT_UPDATED: "assessment:updated",
  ENTRY_ASSESSMENT_EVALUATED: "assessment:entry-evaluated",
});

module.exports = { ASSESSMENT_EVENT_NAMES };
