const { EventEmitter } = require("events");

/**
 * In-process pub/sub for this agent's outputs — its own bus, independent
 * of Observation's and Student State's, so each agent stays independently
 * deployable/swappable (see those modules' eventBus.js for the same
 * rationale).
 */
class AssessmentEventBus {
  constructor() {
    this._emitter = new EventEmitter();
    this._emitter.setMaxListeners(50);
  }

  publish(eventName, payload) {
    setImmediate(() => {
      this._emitter.emit(eventName, payload);
    });
  }

  subscribe(eventName, handler) {
    const safeHandler = (payload) => {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[assessment:eventBus] subscriber threw on "${eventName}":`, error);
      }
    };

    this._emitter.on(eventName, safeHandler);
    return () => this._emitter.off(eventName, safeHandler);
  }
}

const assessmentBus = new AssessmentEventBus();

module.exports = { assessmentBus, AssessmentEventBus };
