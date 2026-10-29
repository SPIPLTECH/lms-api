const { EventEmitter } = require("events");

/** The Learning Path agent's own event bus (agent contract: not shared). */

const STUDY_PLAN_EVENT_NAMES = Object.freeze({
  PLAN_UPDATED: "study-plan:updated",
});

const bus = new EventEmitter();
bus.setMaxListeners(50);

/** Handlers run asynchronously; a failing one is logged, never propagated. */
function subscribe(eventName, handler) {
  const listener = (payload) => {
    Promise.resolve()
      .then(() => handler(payload))
      .catch((error) => console.warn("[study-plan] subscriber failed", { eventName, error: error?.message }));
  };
  bus.on(eventName, listener);
  return () => bus.off(eventName, listener);
}

const publish = (eventName, payload) => bus.emit(eventName, payload);

module.exports = { subscribe, publish, STUDY_PLAN_EVENT_NAMES };
