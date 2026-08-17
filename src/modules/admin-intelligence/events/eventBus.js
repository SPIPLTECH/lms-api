const { EventEmitter } = require("events");

/**
 * In-process pub/sub for this agent's outputs — its own bus, independent of
 * every other agent's, so each stays independently deployable/swappable.
 */
class AdminIntelligenceEventBus {
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
        console.error(`[admin-intelligence:eventBus] subscriber threw on "${eventName}":`, error);
      }
    };

    this._emitter.on(eventName, safeHandler);
    return () => this._emitter.off(eventName, safeHandler);
  }
}

const adminIntelligenceBus = new AdminIntelligenceEventBus();

module.exports = { adminIntelligenceBus, AdminIntelligenceEventBus };
