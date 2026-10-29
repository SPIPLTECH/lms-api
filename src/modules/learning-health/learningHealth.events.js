const { EventEmitter } = require("events");

/**
 * The Learning Health agent's own in-process event bus — not shared with any
 * other module (the agent contract: each agent owns its bus, so it stays
 * independently deployable). Downstream agents (Motivation first) react to
 * STATE_UPDATED through `subscribe`, never by reading this module's tables.
 */

const LEARNING_HEALTH_EVENT_NAMES = Object.freeze({
  STATE_UPDATED: "learning-health:updated",
});

const bus = new EventEmitter();
bus.setMaxListeners(50);

/**
 * Registers a handler. Handlers run asynchronously and a failing one is
 * logged, never propagated — a broken subscriber cannot break a recompute.
 *
 * @param {string} eventName
 * @param {(payload: object) => (void|Promise<void>)} handler
 * @returns {() => void} unsubscribe
 */
function subscribe(eventName, handler) {
  const listener = (payload) => {
    Promise.resolve()
      .then(() => handler(payload))
      .catch((error) => {
        console.warn("[learning-health] subscriber failed", { eventName, error: error?.message });
      });
  };
  bus.on(eventName, listener);
  return () => bus.off(eventName, listener);
}

function publish(eventName, payload) {
  bus.emit(eventName, payload);
}

module.exports = { subscribe, publish, LEARNING_HEALTH_EVENT_NAMES };
