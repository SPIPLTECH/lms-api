/**
 * Channel names six already-built agents (Recommendation, Assessment,
 * Motivation, Teacher Insight, Analytics, Career Guidance) already
 * subscribe to defensively — PATH_UPDATED's value must stay exactly
 * "learning-path:updated" since that's also their hardcoded fallback
 * string when this constant isn't present.
 */
const LEARNING_PATH_EVENT_NAMES = Object.freeze({
  PATH_UPDATED: "learning-path:updated",
});

module.exports = { LEARNING_PATH_EVENT_NAMES };
