const observation = require("../../observation");
const studentStateService = require("../services/studentState.service");

/**
 * Subscribes to the Observation Agent's public event bus. This is the
 * *primary* input path — near-real-time, in-process, zero HTTP overhead.
 * It is not the only path: because the bus is in-memory, an event that is
 * published while this process is mid-restart is never delivered here.
 * That's fine — LearningEvent is durably persisted regardless, and
 * POST /student-state/recalculate (plus the reconciliation scheduler)
 * exists precisely to rebuild state from the durable log when needed.
 */
const start = () => {
  const unsubscribe = observation.subscribe(
    observation.OBSERVATION_EVENT_NAMES.EVENT_CREATED,
    handleObservationEvent
  );

  console.log("[student-state] subscribed to observation:event.created");
  return unsubscribe;
};

const handleObservationEvent = async (event) => {
  try {
    await studentStateService.processEvent(event);
  } catch (error) {
    console.error(`[student-state] failed to process event ${event?.id}:`, error);
  }
};

module.exports = { start, handleObservationEvent };
