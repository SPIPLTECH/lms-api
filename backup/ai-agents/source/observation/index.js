const router = require("./routes/observation.routes");
const observationService = require("./service/observation.service");
const { observationBus } = require("./events/eventBus");
const { OBSERVATION_EVENT_NAMES } = require("./events/eventNames");
const { EVENT_TYPES, EVENT_CATEGORIES } = require("./constants");

/**
 * Public surface of the Observation Agent for the rest of the backend:
 *
 *   const { publishEvent, EVENT_TYPES } = require("../observation");
 *   await publishEvent({ studentId, eventType: EVENT_TYPES.QUIZ_SUBMITTED, courseId, quizId });
 *
 * `router` is mounted at /events in app.js. `publishEvent` is how any other
 * module records an event without an HTTP round-trip. `subscribe` is how a
 * future agent (Learning Path, Analytics, ...) listens for newly observed
 * events without depending on this module's internals.
 */
module.exports = {
  router,
  publishEvent: observationService.recordInternalEvent,
  subscribe: observationBus.subscribe.bind(observationBus),
  getStudentEventLog: observationService.getStudentEventLog,
  getEventById: observationService.getEventById,
  OBSERVATION_EVENT_NAMES,
  EVENT_TYPES,
  EVENT_CATEGORIES,
};
