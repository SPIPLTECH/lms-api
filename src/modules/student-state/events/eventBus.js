const { EventEmitter } = require("events");

/**
 * In-process pub/sub for this agent's outputs — deliberately separate from
 * the Observation Agent's bus. Each agent owns its own transport so it can
 * be swapped or moved to its own process independently (e.g. this bus
 * becomes a Kafka topic while Observation's stays in-process, with no
 * coordination needed between them).
 */
class StudentStateEventBus {
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
        console.error(`[student-state:eventBus] subscriber threw on "${eventName}":`, error);
      }
    };

    this._emitter.on(eventName, safeHandler);
    return () => this._emitter.off(eventName, safeHandler);
  }
}

const studentStateBus = new StudentStateEventBus();

module.exports = { studentStateBus, StudentStateEventBus };
