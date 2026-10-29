const { EventEmitter } = require("events");

/**
 * The Motivation agent's own event bus (agent contract: not shared). Published
 * after a learner's streak/nudges are recomputed.
 */

const MOTIVATION_EVENT_NAMES = Object.freeze({
  MOTIVATION_UPDATED: "motivation:updated",
});

const bus = new EventEmitter();
bus.setMaxListeners(50);

/** Handlers run asynchronously; a failing one is logged, never propagated. */
function subscribe(eventName, handler) {
  const listener = (payload) => {
    Promise.resolve()
      .then(() => handler(payload))
      .catch((error) => console.warn("[motivation] subscriber failed", { eventName, error: error?.message }));
  };
  bus.on(eventName, listener);
  return () => bus.off(eventName, listener);
}

const publish = (eventName, payload) => bus.emit(eventName, payload);

module.exports = { subscribe, publish, MOTIVATION_EVENT_NAMES };
