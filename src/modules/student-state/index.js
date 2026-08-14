const router = require("./routes/studentState.routes");
const eventConsumer = require("./events/eventConsumer");
const reconciliationScheduler = require("./schedulers/reconciliation.scheduler");
const { studentStateBus } = require("./events/eventBus");
const { STUDENT_STATE_EVENT_NAMES } = require("./events/eventNames");
const studentStateService = require("./services/studentState.service");
const studentCourseStateService = require("./services/studentCourseState.service");

/**
 * Public surface of the Student State Agent:
 *
 *   const studentState = require("../student-state");
 *   studentState.subscribe(studentState.STUDENT_STATE_EVENT_NAMES.STATE_UPDATED, (payload) => { ... });
 *
 * `router` is mounted at /student-state in app.js. `bootstrap()` wires the
 * live event subscription and the reconciliation scheduler — call it once
 * at process startup (server.js), same as the message-cleanup cron.
 * Future agents (Learning Path, Recommendation, Motivation, Teacher
 * Insight, Analytics, Career Guidance, Placement) integrate via `subscribe`
 * or the REST API — never by reaching into this module's internals.
 */
const bootstrap = () => {
  eventConsumer.start();
  reconciliationScheduler.start();
};

module.exports = {
  router,
  bootstrap,
  subscribe: studentStateBus.subscribe.bind(studentStateBus),
  STUDENT_STATE_EVENT_NAMES,
  recalculate: studentStateService.recalculate,
  getRiskSnapshot: studentStateService.getRiskSnapshot,
  getFullState: studentStateService.getFullState,
  getBatchStates: studentStateService.getBatchStates,
  getHighRiskStudents: studentStateService.getHighRiskStudents,
  initializeCourseState: studentCourseStateService.initializeCourseState,
  getCourseState: studentCourseStateService.getCourseState,
};
