const ApiError = require("../../../utils/ApiError");
const observation = require("../../observation");

const studentStateRepository = require("../repositories/studentState.repository");
const studentRiskRepository = require("../repositories/studentRisk.repository");
const { applyEvent, refreshForInactivity } = require("./reducers");
const { studentStateBus } = require("../events/eventBus");
const { STUDENT_STATE_EVENT_NAMES } = require("../events/eventNames");
const {
  toFullStateResponse,
  toDashboardResponse,
  toDomainSliceResponse,
} = require("../dto/studentStateResponse.dto");
const { defaultAggregate } = require("../constants/defaultDomainState.constants");

/**
 * Throws if an event is structurally unusable. Observation Agent events are
 * already validated at ingestion, but this reducer pipeline is a second
 * boundary (fed by an in-memory bus and by raw DB rows during replay) and
 * must not silently corrupt state on a malformed input.
 */
const validateEvent = (event) => {
  if (!event || typeof event !== "object") {
    throw new ApiError(400, "Event must be an object");
  }
  if (!event.studentId) throw new ApiError(400, "Event is missing studentId");
  if (!event.eventType) throw new ApiError(400, "Event is missing eventType");
  if (!event.createdAt) throw new ApiError(400, "Event is missing createdAt");
};

/**
 * Receive -> Validate -> Identify -> Update (progress/performance/
 * engagement/behavior/risk) -> Calculate scores -> Persist -> Publish.
 *
 * @param {object} event - a LearningEvent row (from the bus or a replay)
 */
const processEvent = async (event) => {
  validateEvent(event);

  const studentId = event.studentId; // "Identify Student"

  const aggregate = await studentStateRepository.getAggregate(studentId);

  // Idempotency: never apply the same event twice (bus redelivery, or a
  // race between the live subscriber and a concurrent recalculate).
  if (!aggregate.isNew && aggregate.state.lastEventId === event.id) {
    return aggregate;
  }

  const nextAggregate = applyEvent(aggregate, event);
  await studentStateRepository.saveAggregate(nextAggregate);

  studentStateBus.publish(STUDENT_STATE_EVENT_NAMES.STATE_UPDATED, {
    studentId,
    triggeredByEventId: event.id,
    state: nextAggregate.state,
  });

  return nextAggregate;
};

/**
 * Event-sourced rebuild: replays a student's entire LearningEvent history
 * from scratch through the same reducers processEvent uses. This is the
 * authoritative way to fix drift, recover from missed bus deliveries, or
 * backfill a student who existed before this agent did.
 *
 * @param {string} studentId
 */
const recalculate = async (studentId) => {
  const events = await observation.getStudentEventLog(studentId);

  let aggregate = { ...defaultAggregate(studentId), id: null, isNew: true };

  for (const event of events) {
    aggregate = applyEvent(aggregate, event);
  }

  aggregate.state.lastRecalculatedAt = new Date();
  await studentStateRepository.saveAggregate(aggregate);

  studentStateBus.publish(STUDENT_STATE_EVENT_NAMES.STATE_UPDATED, {
    studentId,
    triggeredByEventId: null,
    state: aggregate.state,
    recalculated: true,
  });

  return { ...aggregate, eventsProcessed: events.length };
};

/**
 * Time-only refresh (no new event) — used by the reconciliation scheduler
 * for students who haven't triggered processEvent recently.
 */
const refreshInactivityRisk = async (studentId, now = new Date()) => {
  const aggregate = await studentStateRepository.getAggregate(studentId);
  if (aggregate.isNew) return aggregate;

  const refreshed = refreshForInactivity(aggregate, now);
  await studentStateRepository.saveAggregate(refreshed);
  return refreshed;
};

const getAggregateOrThrow = async (studentId) => {
  return await studentStateRepository.getAggregate(studentId);
};

const getFullState = async (studentId) => {
  const aggregate = await studentStateRepository.getAggregate(studentId);
  return toFullStateResponse(aggregate);
};

/**
 * Trusted, minimal server-to-server read for other agents (e.g. the
 * Assessment Agent's reassessment-escalation logic) that need only the
 * risk snapshot, not the whole aggregate. Returns null rather than
 * throwing when no state exists yet — absence is a normal case for a
 * cross-agent caller, not an error.
 */
const getRiskSnapshot = async (studentId) => {
  const aggregate = await studentStateRepository.getAggregate(studentId);
  if (aggregate.isNew) return null;

  return {
    dropoutRiskScore: aggregate.risk.dropoutRiskScore,
    dropoutRiskLevel: aggregate.risk.dropoutRiskLevel,
    inactivityDays: aggregate.risk.inactivityDays,
  };
};

const getDashboard = async (studentId) => {
  const aggregate = await getAggregateOrThrow(studentId);
  return toDashboardResponse(aggregate);
};

const getDomainSlice = async (studentId, domain) => {
  const aggregate = await getAggregateOrThrow(studentId);
  return toDomainSliceResponse(aggregate, domain);
};

/**
 * Batch counterpart to getFullState, for consumers aggregating many
 * students at once (e.g. Teacher Insight's class-wide reads) — one query
 * instead of N. Students with no state yet are simply absent, not padded
 * with defaults.
 *
 * @param {string[]} studentIds
 */
const getBatchStates = async (studentIds) => {
  const aggregates = await studentStateRepository.getBatchAggregates(studentIds);
  return aggregates.map(toFullStateResponse);
};

/**
 * Trusted, cross-agent read (the Admin Intelligence Agent's institution-wide
 * risk detection) — one real query via studentRiskRepository.findHighRisk,
 * not a per-student loop over getRiskSnapshot.
 *
 * @param {("HIGH"|"MEDIUM")[]} [levels]
 */
const getHighRiskStudents = async (levels = ["HIGH"]) => {
  const rows = await studentRiskRepository.findHighRisk(levels);
  return rows.map((row) => ({
    studentId: row.state.studentId,
    dropoutRiskScore: row.dropoutRiskScore,
    dropoutRiskLevel: row.dropoutRiskLevel,
    inactivityDays: row.inactivityDays,
  }));
};

module.exports = {
  processEvent,
  recalculate,
  refreshInactivityRisk,
  getFullState,
  getRiskSnapshot,
  getDashboard,
  getDomainSlice,
  getBatchStates,
  getHighRiskStudents,
};
