const router = require("./routes/teacherInsight.routes");
const eventConsumer = require("./events/eventConsumer");
const dailyClassSweepScheduler = require("./schedulers/dailyClassSweep.scheduler");
const weeklySummaryScheduler = require("./schedulers/weeklySummary.scheduler");
const monthlySummaryScheduler = require("./schedulers/monthlySummary.scheduler");
const { teacherInsightBus } = require("./events/eventBus");
const { TEACHER_INSIGHT_EVENT_NAMES } = require("./events/eventNames");
const teacherInsightService = require("./services/teacherInsight.service");

/**
 * Public surface of the Teacher Insight Agent:
 *
 *   const teacherInsights = require("../teacher-insights");
 *   teacherInsights.subscribe(teacherInsights.TEACHER_INSIGHT_EVENT_NAMES.TEACHER_INSIGHT_UPDATED, (payload) => { ... });
 *
 * `router` is mounted at /teacher-insights in app.js. `bootstrap()` wires
 * the live event subscriptions (Student State, Assessment, Recommendation,
 * and Motivation update signals, plus a targeted Observation subscription
 * for QUIZ_COMPLETED/ASSIGNMENT_SUBMITTED, Learning Path defensively — see
 * events/eventConsumer.js) and three schedulers: a daily class-wide sweep,
 * a weekly summary, and a monthly report.
 *
 * Future agents (Analytics, Admin Intelligence, Career Guidance, Placement,
 * AI Mentor) integrate via `subscribe` or the REST API — never by reaching
 * into this module's internals.
 *
 * ---
 * Unlike every prior agent, this one is course-scoped, not student-scoped:
 * it aggregates every enrolled student's data per course rather than
 * tracking one student at a time. It owns no source-of-truth learning
 * data, only its own insight ledger, and it never modifies grades, course
 * content, or enrollments, sends anything directly, or overrides the
 * instructor's own decisions — only generates insights and recommendations
 * for them to act on.
 *
 * Two documented gaps in the current LMS domain shaped this module:
 *
 * 1. No attendance-tracking model exists anywhere in this LMS (LiveClass/
 *    BatchSession are schedules, not attendee logs) and no course-
 *    discussion-thread model exists either (only DISCUSSION_* Observation
 *    event types). "Attendance patterns" is realized as class-wide active-
 *    learning-day consistency from Student State's real engagement data,
 *    not a fabricated check-in system.
 *
 * 2. The Learning Path Agent referenced in this agent's inputs does not
 *    exist yet. Both the event subscription and the context read
 *    (services/context/courseContextBuilder.js) are defensive (try/
 *    require, no-ops/[] if absent) — and, notably, modeled the same way
 *    the other four producers are (a batch read), since Learning Path will
 *    be per-student like them, not per-course.
 */
const bootstrap = () => {
  eventConsumer.start();
  dailyClassSweepScheduler.start();
  weeklySummaryScheduler.start();
  monthlySummaryScheduler.start();
};

module.exports = {
  router,
  bootstrap,
  subscribe: teacherInsightBus.subscribe.bind(teacherInsightBus),
  TEACHER_INSIGHT_EVENT_NAMES,
  recalculate: teacherInsightService.recalculate,
  generateForCourse: teacherInsightService.generateForCourse,
  getTeacherDashboard: teacherInsightService.getTeacherDashboard,
};
