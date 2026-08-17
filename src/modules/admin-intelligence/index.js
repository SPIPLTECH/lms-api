const router = require("./routes/adminIntelligence.routes");
const eventConsumer = require("./events/eventConsumer");
const dailySweepScheduler = require("./schedulers/dailySweep.scheduler");
const reportScheduler = require("./schedulers/reportScheduler");
const { adminIntelligenceBus } = require("./events/eventBus");
const { ADMIN_INTELLIGENCE_EVENT_NAMES } = require("./events/eventNames");
const adminIntelligenceService = require("./services/adminIntelligence.service");

/**
 * Public surface of the Admin Intelligence Agent:
 *
 *   const adminIntelligence = require("../admin-intelligence");
 *   adminIntelligence.subscribe(adminIntelligence.ADMIN_INTELLIGENCE_EVENT_NAMES.ADMIN_INSIGHT_UPDATED, (payload) => { ... });
 *
 * `router` is mounted at /admin-intelligence in app.js. `bootstrap()` wires
 * the live event subscriptions (Analytics/Teacher Insight/Student State —
 * see events/eventConsumer.js) and two schedulers: a daily full sweep (the
 * only honest trigger for Enrollment/Semester/Revenue/Infrastructure
 * changes, none of which have a real event anywhere in this codebase) and
 * the five weekly/monthly/quarterly/annual/semester report crons.
 *
 * Future systems (AI Mentor Agent, Business Intelligence tools, ERP/HR/
 * Finance systems, government reporting) integrate via `subscribe` or the
 * REST API — never by reaching into this module's internals.
 *
 * ---
 * This agent sits one layer above Analytics, not beside it: Analytics
 * already aggregates Assessment/Motivation/Recommendation/etc. into 22
 * platform/course/instructor/student metrics ("it aggregates the
 * aggregators, not raw events"), so this agent aggregates Analytics'
 * already-computed platform/course/instructor KPIs (via two new getters
 * added to Analytics' own index.js: getPlatformKPIs/getCourseKPIsBatch/
 * getInstructorKPIsBatch), Teacher Insight's real per-course CourseHealth
 * (via its existing getTeacherDashboard(instructorId)), and Student State's
 * real risk data (via a new getHighRiskStudents() getter added to Student
 * State's own index.js) — it never re-derives what Assessment/Motivation/
 * Recommendation/Career/Placement/Learning Path already feed into Analytics.
 *
 * Per the constraints, this agent is 100% read + insight-generation: it
 * must never modify academic records, automatically change policies,
 * automatically suspend users, automatically assign instructors, or
 * automatically modify courses. Every write in this module is either an
 * upsert of this agent's own generated insight/recommendation/alert/audit/
 * forecast rows, or a report export — nothing here ever touches another
 * module's tables.
 *
 * Honest domain gaps (none of these models/systems exist anywhere else in
 * this LMS — see schema.prisma's own doc comment on this agent's models for
 * the full reasoning):
 *
 * 1. No Department model — "department" is Course.category, the only real
 *    institutional grouping dimension this LMS has (nullable free text,
 *    bucketed under "UNCATEGORIZED" when absent).
 * 2. No Faculty model — "faculty" is an instructor (User.role=INSTRUCTOR),
 *    same vocabulary Teacher Insight already uses.
 * 3. No Semester/AcademicCalendar model — CalendarEvent is a flat,
 *    non-relational row, not a term registry. "Semester" report boundaries
 *    are this agent's own configurable Jan 1 / Jul 1 approximation.
 * 4. No Attendance model anywhere in this LMS (same gap Teacher Insight's
 *    own index.js already documents) — not used by this agent.
 * 5. No Revenue/Subscription/Payment model — revenueEstimate is Analytics'
 *    own attributed estimate (enrollments x price), reused as-is, not
 *    recomputed; there is no subscription-tier system to report on beyond
 *    StudentProfile.plan's cosmetic free-text field.
 * 6. No SystemLog/AuditLog model anywhere in this LMS. "Audit AI decisions"
 *    is realized as a real scan of Teaching Recommendation's own
 *    confidenceScore data (already gathered via getTeacherDashboard) for
 *    out-of-range values and an elevated low-confidence ratio — a genuine
 *    audit of real cross-agent AI-decision data, not a fabricated log read.
 *    ComplianceAudit is this agent's own append-only audit ledger, since no
 *    platform-wide audit table exists to consume instead.
 * 7. Two of the four CapacityForecast resource types (INSTRUCTOR_CAPACITY,
 *    INFRASTRUCTURE_LOAD) have no honest daily time-series to regress on,
 *    so they use an explicitly lower-confidence derived projection (method
 *    RATIO_PROJECTION / TREND_EXTRAPOLATION) rather than a fabricated OLS
 *    fit — see services/domain/capacityForecastEngine.js.
 */
const bootstrap = () => {
  eventConsumer.start();
  dailySweepScheduler.start();
  reportScheduler.start();
};

module.exports = {
  router,
  bootstrap,
  subscribe: adminIntelligenceBus.subscribe.bind(adminIntelligenceBus),
  ADMIN_INTELLIGENCE_EVENT_NAMES,
  recalculate: adminIntelligenceService.recalculate,
  generateInsights: adminIntelligenceService.generateInsights,
  getDashboard: adminIntelligenceService.getDashboard,
};
