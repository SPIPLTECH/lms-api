const router = require("./routes/assessment.routes");
const eventConsumer = require("./events/eventConsumer");
const reassessmentDueScheduler = require("./schedulers/reassessmentDue.scheduler");
const { assessmentBus } = require("./events/eventBus");
const { ASSESSMENT_EVENT_NAMES } = require("./events/eventNames");
const assessmentService = require("./services/assessment.service");

/**
 * Public surface of the Assessment Agent:
 *
 *   const assessment = require("../assessment");
 *   assessment.subscribe(assessment.ASSESSMENT_EVENT_NAMES.ASSESSMENT_UPDATED, (payload) => { ... });
 *
 * `router` is mounted at /assessment in app.js. `bootstrap()` wires the
 * live event subscriptions (Observation for evaluative events, Student
 * State for risk-escalation reconciliation, Learning Path defensively —
 * see events/eventConsumer.js) and the reassessment-due scheduler.
 *
 * Future agents (Recommendation, Motivation, Teacher Insight, Analytics,
 * Career Guidance, Placement) integrate via `subscribe` or the REST API —
 * never by reaching into this module's internals.
 *
 * ---
 * Two documented gaps in the current LMS domain that shaped this module:
 *
 * 1. "Coding exercise" has no model/EventType anywhere in this codebase.
 *    Its evaluation path piggybacks on QUIZ_COMPLETED/ASSIGNMENT_SUBMITTED
 *    events carrying `payload.exerciseType === "CODING"` — see
 *    services/domain/evidenceExtractor.js. The moment a real coding-
 *    exercise feature exists with its own EventType, this pipeline
 *    consumes it with no redesign.
 *
 * 2. The Learning Path Agent referenced in this agent's future-integration
 *    requirements does not exist in this codebase yet. The subscription in
 *    events/eventConsumer.js is defensive (try/require, no-ops if absent)
 *    so wiring it in later is a one-line change, not a rewrite.
 */
const bootstrap = () => {
  eventConsumer.start();
  reassessmentDueScheduler.start();
};

module.exports = {
  router,
  bootstrap,
  subscribe: assessmentBus.subscribe.bind(assessmentBus),
  ASSESSMENT_EVENT_NAMES,
  recalculate: assessmentService.recalculate,
  getFullState: assessmentService.getFullState,
  getKnowledgeGaps: assessmentService.getKnowledgeGaps,
  getRecommendations: assessmentService.getRecommendations,
  getBatchAssessmentSummary: assessmentService.getBatchAssessmentSummary,
};
