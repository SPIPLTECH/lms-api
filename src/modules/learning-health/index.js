const service = require("./learningHealth.service");
const { subscribe, LEARNING_HEALTH_EVENT_NAMES } = require("./learningHealth.events");

/**
 * Learning Health agent — public surface.
 *
 * Other modules and agents use only what is exported here, never this
 * module's files or tables directly. Getters resolve to null / [] when there
 * is no data and never throw.
 */
module.exports = {
  // Triggers
  scheduleRecompute: service.scheduleRecompute,
  sweepCourse: service.sweepCourse,
  sweepAll: service.sweepAll,

  // Cross-agent reads (names kept from the original Student State agent)
  getState: service.getState,
  getCourseStates: service.getCourseStates,
  getStudentStates: service.getStudentStates,
  getBatchStates: service.getBatchStates,
  getHighRiskStudents: service.getHighRiskStudents,
  getCourseAggregates: service.getCourseAggregates,
  getPlatformAggregates: service.getPlatformAggregates,

  // Events
  subscribe,
  LEARNING_HEALTH_EVENT_NAMES,

  // Lazy, so write-path modules that require this file for scheduleRecompute
  // don't pull the HTTP layer (and its middleware) into their load order.
  get router() {
    return require("./learningHealth.routes");
  },
};
