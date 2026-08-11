const observation = require("../../observation");
const studentState = require("../../student-state");
const learningPath = require("../../learning-path");
const assessment = require("../../assessment");
const recommendation = require("../../recommendation");
const motivation = require("../../motivation");
const teacherInsights = require("../../teacher-insights");
const analytics = require("../../analytics");
const career = require("../../career");
const placement = require("../../placement");
const adminIntelligence = require("../../admin-intelligence");

const { INTENT, USER_ROLE, RECENT_ACTIVITY_EVENT_LIMIT } = require("../constants");

/**
 * Decides "which agents should be queried" for one turn — the spec's own
 * question, answered as a plain declarative table rather than an inferred
 * heuristic, so it stays auditable and easy to extend for a 12th agent.
 * Every entry calls only a peer agent's own public getter (see each
 * module's index.js) — never reaches into another module's internals.
 *
 * "In what order?" — every descriptor returned here is independent (no
 * descriptor's args depend on another descriptor's result), so the
 * orchestrator runs them all in parallel via safeInvokeAll. The only real
 * ordering dependency in this whole pipeline is resolving the actor's
 * studentId/instructorId first (context-engine/resolveActor.js), which
 * happens once, before agent selection, not per-agent.
 *
 * A STUDENT/GENERAL turn with no strong intent signal still gets a light
 * "always useful" base set (student state + recent recommendations) so a
 * genuinely ambiguous message still gets a grounded reply rather than an
 * empty context.
 */

const studentDescriptor = (name, method, fn) => ({ agentName: name, method, invoke: fn });

const STUDENT_AGENTS_BY_INTENT = {
  [INTENT.LEARNING]: (studentId) => [
    studentDescriptor("learning-path", "getFullState", () => learningPath.getFullState(studentId)),
    studentDescriptor("student-state", "getFullState", () => studentState.getFullState(studentId)),
  ],
  [INTENT.ASSESSMENT]: (studentId) => [
    studentDescriptor("assessment", "getFullState", () => assessment.getFullState(studentId)),
    studentDescriptor("assessment", "getKnowledgeGaps", () => assessment.getKnowledgeGaps(studentId)),
  ],
  [INTENT.RECOMMENDATION]: (studentId) => [studentDescriptor("recommendation", "getByStudent", () => recommendation.getByStudent(studentId))],
  [INTENT.CAREER]: (studentId) => [studentDescriptor("career", "getFullState", () => career.getFullState(studentId))],
  [INTENT.PLACEMENT]: (studentId) => [studentDescriptor("placement", "getProfile", () => placement.getProfile(studentId))],
  [INTENT.MOTIVATION]: (studentId) => [
    studentDescriptor("motivation", "getBatchMotivationSummary", () => motivation.getBatchMotivationSummary([studentId])),
    studentDescriptor("student-state", "getRiskSnapshot", () => studentState.getRiskSnapshot(studentId)),
  ],
  [INTENT.NAVIGATION]: () => [],
  [INTENT.TECHNICAL_SUPPORT]: () => [],
  [INTENT.GENERAL]: (studentId) => [studentDescriptor("student-state", "getFullState", () => studentState.getFullState(studentId))],
};

const STUDENT_BASE_AGENTS = (studentId) => [
  studentDescriptor("recommendation", "getByStudent", () => recommendation.getByStudent(studentId)),
  studentDescriptor("observation", "getStudentEventLog", () => observation.getStudentEventLog(studentId)),
];

const INSTRUCTOR_AGENTS_BY_INTENT = {
  [INTENT.ANALYTICS]: (instructorId) => [
    studentDescriptor("analytics", "getInstructorKPIsBatch", () => analytics.getInstructorKPIsBatch([instructorId])),
  ],
};

const ADMIN_AGENTS_BY_INTENT = {
  [INTENT.ANALYTICS]: () => [studentDescriptor("analytics", "getPlatformKPIs", () => analytics.getPlatformKPIs())],
};

/**
 * @param {import("../types/mentor.types").Actor} actor
 * @param {import("../types/mentor.types").MentorIntentType} intent
 * @returns {import("../types/mentor.types").AgentCallDescriptor[]}
 */
const selectAgentCalls = (actor, intent) => {
  if (actor.role === USER_ROLE.STUDENT) {
    const intentDescriptors = (STUDENT_AGENTS_BY_INTENT[intent] || STUDENT_AGENTS_BY_INTENT[INTENT.GENERAL])(actor.studentId);
    return [...intentDescriptors, ...STUDENT_BASE_AGENTS(actor.studentId)];
  }

  if (actor.role === USER_ROLE.INSTRUCTOR) {
    const intentDescriptors = (INSTRUCTOR_AGENTS_BY_INTENT[intent] || (() => []))(actor.instructorId);
    return [
      studentDescriptor("teacher-insights", "getTeacherDashboard", () => teacherInsights.getTeacherDashboard(actor.instructorId)),
      ...intentDescriptors,
    ];
  }

  if (actor.role === USER_ROLE.ADMIN) {
    const intentDescriptors = (ADMIN_AGENTS_BY_INTENT[intent] || (() => []))();
    return [studentDescriptor("admin-intelligence", "getDashboard", () => adminIntelligence.getDashboard()), ...intentDescriptors];
  }

  return [];
};

module.exports = { selectAgentCalls, RECENT_ACTIVITY_EVENT_LIMIT };
