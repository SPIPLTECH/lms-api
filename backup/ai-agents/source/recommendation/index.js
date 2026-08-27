const router = require("./routes/recommendation.routes");
const eventConsumer = require("./events/eventConsumer");
const deadlineScanScheduler = require("./schedulers/deadlineScan.scheduler");
const dailyDigestScheduler = require("./schedulers/dailyDigest.scheduler");
const { recommendationBus } = require("./events/eventBus");
const { RECOMMENDATION_EVENT_NAMES } = require("./events/eventNames");
const recommendationService = require("./services/recommendation.service");

/**
 * Public surface of the Recommendation Agent:
 *
 *   const recommendation = require("../recommendation");
 *   recommendation.subscribe(recommendation.RECOMMENDATION_EVENT_NAMES.RECOMMENDATION_UPDATED, (payload) => { ... });
 *
 * `router` is mounted at /recommendations in app.js. `bootstrap()` wires
 * the live event subscriptions (Observation for significant events,
 * Student State + Assessment for their update signals, Learning Path
 * defensively — see events/eventConsumer.js) and two schedulers: a 30-min
 * deadline scan and a daily digest/expiry sweep.
 *
 * Future agents (Motivation, Teacher Insight, Analytics, Career Guidance,
 * Placement, AI Mentor) integrate via `subscribe` or the REST API — never
 * by reaching into this module's internals.
 *
 * ---
 * This agent is a pure consumer/synthesizer: it owns no source-of-truth
 * learning data, only its own recommendation ledger. It never modifies
 * grades, quiz/question content, assignment evaluations, course content,
 * enrollments, or sends notifications directly.
 *
 * Three documented gaps in the current LMS domain shaped this module:
 *
 * 1. The Learning Path Agent referenced in this agent's inputs does not
 *    exist in this codebase yet. Both the event subscription
 *    (events/eventConsumer.js) and the context read
 *    (services/context/studentContextBuilder.js) are defensive
 *    (try/require, no-ops/null if absent) — wiring it in later needs no
 *    changes here.
 *
 * 2. Neither "New Course Published" nor "Student Goal Changed" has a
 *    corresponding Observation EventType, so there's no real-time hook for
 *    either. Both are covered by the daily digest scheduler re-reading
 *    live Course/StudentProfile state every cycle instead — true real-time
 *    reactivity for these two would need a small instrumentation change in
 *    the Course/Profile controllers, outside this module's boundary to add
 *    unilaterally.
 *
 * 3. "Recommend projects" (RESPONSIBILITIES) has no backing Project model
 *    anywhere in this LMS, and the OUTPUT section's fixed 12-type list has
 *    no PROJECT entry either — so no generator fabricates one. Similarly,
 *    coding-exercise practice rides on the same course-category heuristic
 *    Assessment's evidenceExtractor documents, not a real exercise catalog.
 */
const bootstrap = () => {
  eventConsumer.start();
  deadlineScanScheduler.start();
  dailyDigestScheduler.start();
};

module.exports = {
  router,
  bootstrap,
  subscribe: recommendationBus.subscribe.bind(recommendationBus),
  RECOMMENDATION_EVENT_NAMES,
  recalculate: recommendationService.recalculate,
  generateForStudent: recommendationService.generateForStudent,
  getByStudent: recommendationService.getByStudent,
  getBatchActiveRecommendations: recommendationService.getBatchActiveRecommendations,
};
