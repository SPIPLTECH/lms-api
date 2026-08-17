const router = require("./routes/motivation.routes");
const eventConsumer = require("./events/eventConsumer");
const reminderDispatchScheduler = require("./schedulers/reminderDispatch.scheduler");
const deadlineScanScheduler = require("./schedulers/deadlineScan.scheduler");
const engagementSweepScheduler = require("./schedulers/engagementSweep.scheduler");
const { motivationBus } = require("./events/eventBus");
const { MOTIVATION_EVENT_NAMES } = require("./events/eventNames");
const motivationService = require("./services/motivation.service");

/**
 * Public surface of the Motivation Agent:
 *
 *   const motivation = require("../motivation");
 *   motivation.subscribe(motivation.MOTIVATION_EVENT_NAMES.MOTIVATION_UPDATED, (payload) => { ... });
 *
 * `router` is mounted at /motivation in app.js. `bootstrap()` wires the
 * live event subscriptions (Student State + Recommendation update signals,
 * Learning Path defensively — see events/eventConsumer.js) and three
 * schedulers: a 15-min reminder dispatch, a 30-min deadline scan, and a
 * daily engagement sweep (trend snapshot + full recompute + expiry).
 *
 * Future systems (Notification Service, Teacher Insight, Analytics, Career
 * Guidance, Placement, AI Mentor) integrate via `subscribe` or the REST API
 * — never by reaching into this module's internals.
 *
 * ---
 * This agent is a pure consumer/synthesizer: it owns no source-of-truth
 * learning data, only its own motivation ledger, and it never sends
 * anything directly — a separate Notification Service (not built here) is
 * responsible for actually delivering what this agent decides to generate.
 * It never modifies grades, generates learning paths, evaluates
 * assessments, changes course content, or enrolls students.
 *
 * Three documented gaps in the current LMS domain shaped this module:
 *
 * 1. The Learning Path Agent referenced in this agent's inputs does not
 *    exist in this codebase yet. Both the event subscription
 *    (events/eventConsumer.js) and the context read
 *    (services/context/studentContextBuilder.js) are defensive
 *    (try/require, no-ops/null if absent).
 *
 * 2. "Student becomes inactive," "Deadline Approaching," "Learning Goal
 *    Missed," and "Milestone Achieved" have no corresponding real-time
 *    event in this codebase (no idle-threshold event, CalendarEvent.date
 *    is a plain String not a queryable DateTime, no goal-tracking model
 *    beyond free-text learningGoals, and StudentAchievement rows are
 *    written directly with no event). All four are covered by scheduled
 *    scans (deadlineScan, engagementSweep) reading live state instead of a
 *    real-time hook.
 *
 * 3. "Course Milestones" has no dedicated model — mapped to real signals
 *    that already exist: COURSE_COMPLETED/MODULE_COMPLETED events for
 *    congratulations.detector.js, and the existing Achievement/
 *    StudentAchievement models for milestoneCelebration.detector.js.
 */
const bootstrap = () => {
  eventConsumer.start();
  reminderDispatchScheduler.start();
  deadlineScanScheduler.start();
  engagementSweepScheduler.start();
};

module.exports = {
  router,
  bootstrap,
  subscribe: motivationBus.subscribe.bind(motivationBus),
  MOTIVATION_EVENT_NAMES,
  recalculate: motivationService.recalculate,
  generateForStudent: motivationService.generateForStudent,
  getBatchMotivationSummary: motivationService.getBatchMotivationSummary,
  getStreak: motivationService.getStreak,
};
