const router = require("./routes/analytics.routes");
const eventConsumer = require("./events/eventConsumer");
const courseInstructorSweepScheduler = require("./schedulers/courseInstructorSweep.scheduler");
const platformDailySweepScheduler = require("./schedulers/platformDailySweep.scheduler");
const reportScheduler = require("./schedulers/reportScheduler");
const { analyticsBus } = require("./events/eventBus");
const { ANALYTICS_EVENT_NAMES } = require("./events/eventNames");
const analyticsService = require("./services/analytics.service");

/**
 * Public surface of the Analytics Agent:
 *
 *   const analytics = require("../analytics");
 *   analytics.subscribe(analytics.ANALYTICS_EVENT_NAMES.ANALYTICS_UPDATED, (payload) => { ... });
 *
 * `router` is mounted at /analytics in app.js. `bootstrap()` wires the live
 * event subscriptions (Student State/Assessment/Recommendation/Motivation
 * for STUDENT-scope, Teacher Insight for COURSE/INSTRUCTOR-scope, a
 * targeted Observation subscription, Learning Path defensively — see
 * events/eventConsumer.js) and three schedulers: an hourly course/
 * instructor sweep, a daily platform sweep + snapshot, and the four
 * weekly/monthly/quarterly/annual report crons.
 *
 * Future systems (Admin Intelligence, Career Guidance, Placement, AI
 * Mentor, Business Intelligence dashboards) integrate via `subscribe` or
 * the REST API — never by reaching into this module's internals.
 *
 * ---
 * This agent is read-only by design: per the constraints, it must never
 * modify student data, grades, or course content, generate recommendations,
 * send notifications, or make learning decisions — it only aggregates,
 * analyzes, and reports on what every other agent has already produced.
 * It reads its student-level metrics through Student State/Assessment/
 * Motivation's own public getters rather than re-deriving them from raw
 * events, and its course/instructor-level "health"/"engagement" metrics
 * through Teacher Insight's — it aggregates the aggregators, it doesn't
 * duplicate a peer's domain logic.
 *
 * Two honest adaptations, since this LMS has neither a Payment/Transaction
 * model nor an APM/monitoring stack (see
 * services/domain/calculators/platform.calculator.js):
 *
 * 1. REVENUE_READY is an *attributed* estimate (enrollments x course
 *    price), not real billing revenue — there's no payment gateway
 *    integration in this codebase to read actual transactions from.
 * 2. SYSTEM_HEALTH is a lightweight DB-round-trip-latency proxy, not a
 *    real observability signal — a genuine one would come from an APM
 *    stack, out of this agent's boundary to fabricate.
 *
 * The Learning Path Agent referenced in this agent's inputs still doesn't
 * exist in this codebase. The event subscription (events/eventConsumer.js)
 * is defensive (try/require, no-op if absent) so wiring it in later needs
 * no changes here.
 */
const bootstrap = () => {
  eventConsumer.start();
  courseInstructorSweepScheduler.start();
  platformDailySweepScheduler.start();
  reportScheduler.start();
};

module.exports = {
  router,
  bootstrap,
  subscribe: analyticsBus.subscribe.bind(analyticsBus),
  ANALYTICS_EVENT_NAMES,
  recalculate: analyticsService.recalculate,
  generateForScope: analyticsService.generateForScope,
  getPlatformKPIs: analyticsService.getPlatformKPIs,
  getCourseKPIsBatch: analyticsService.getCourseKPIsBatch,
  getInstructorKPIsBatch: analyticsService.getInstructorKPIsBatch,
};
