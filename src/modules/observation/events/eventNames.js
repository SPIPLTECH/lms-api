/**
 * Channel names future agents (Learning Path, Assessment, Recommendation,
 * Motivation, Teacher Insight, Analytics) subscribe to.
 */
const OBSERVATION_EVENT_NAMES = Object.freeze({
  EVENT_CREATED: "observation:event.created",
  STATE_UPDATED: "observation:state.updated",
});

module.exports = { OBSERVATION_EVENT_NAMES };
