const { EventEmitter } = require("events");

/**
 * In-process pub/sub for the Observation Agent's outputs.
 *
 * This is deliberately a thin wrapper (publish/subscribe only) rather than
 * exposing the raw EventEmitter, so the transport can be swapped later
 * (Kafka, Redis Streams, SQS) for horizontal scaling without any consumer
 * (Learning Path Agent, Analytics Agent, etc.) changing a single line —
 * they only ever call `observationBus.subscribe(name, handler)`.
 *
 * Listener errors are caught and logged, never allowed to crash the
 * request that triggered the publish — subscribers are downstream
 * consumers, not part of the write path's correctness.
 */
class ObservationEventBus {
  constructor() {
    this._emitter = new EventEmitter();
    this._emitter.setMaxListeners(50);
  }

  /**
   * @param {string} eventName
   * @param {object} payload
   */
  publish(eventName, payload) {
    setImmediate(() => {
      try {
        this._emitter.emit(eventName, payload);
      } catch (error) {
        console.error(`[observation:eventBus] listener error on "${eventName}":`, error);
      }
    });
  }

  /**
   * @param {string} eventName
   * @param {(payload: object) => void} handler
   * @returns {() => void} unsubscribe function
   */
  subscribe(eventName, handler) {
    const safeHandler = (payload) => {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[observation:eventBus] subscriber threw on "${eventName}":`, error);
      }
    };

    this._emitter.on(eventName, safeHandler);
    return () => this._emitter.off(eventName, safeHandler);
  }
}

// Singleton — one bus per process, shared by every publisher/subscriber.
const observationBus = new ObservationEventBus();

module.exports = { observationBus, ObservationEventBus };
