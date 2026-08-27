const ApiError = require("../../../utils/ApiError");

const learningEventRepository = require("../repository/learningEvent.repository");
const studentStateService = require("./studentState.service");
const { normalizeEvent } = require("../utils/normalizeEvent.util");
const { buildCreatedAtFilter, getTodayRange } = require("../utils/dateRange.util");
const { toEventResponse, toEventListResponse } = require("../dto/eventResponse.dto");
const { toStatisticsResponse } = require("../dto/statisticsResponse.dto");
const { observationBus } = require("../events/eventBus");
const { OBSERVATION_EVENT_NAMES } = require("../events/eventNames");
const { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } = require("../constants");
const { createEventSchema } = require("../validation/observation.validation");

const STAFF_ROLES = ["ADMIN", "INSTRUCTOR"];
const isStaff = (role) => STAFF_ROLES.includes(role);

/**
 * Resolves which StudentProfile an operation targets, and enforces that a
 * STUDENT actor can never read or write another student's data.
 *
 * @param {{role: string, studentId: string|null}} actor
 * @param {string|undefined} requestedStudentId
 * @returns {string}
 */
const resolveTargetStudentId = (actor, requestedStudentId) => {
  if (actor.role === "STUDENT") {
    if (requestedStudentId && requestedStudentId !== actor.studentId) {
      throw new ApiError(403, "Students may only access their own learning events");
    }
    return actor.studentId;
  }

  // Staff must be explicit about whose data they're touching.
  if (!requestedStudentId) {
    throw new ApiError(400, "studentId is required for staff-initiated requests");
  }

  return requestedStudentId;
};

const clampPagination = (page, limit) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE));
  return { skip: (safePage - 1) * safeLimit, take: safeLimit, page: safePage, limit: safeLimit };
};

/**
 * Ingests one event: authorize -> normalize -> persist -> update state -> publish.
 *
 * @param {object} args
 * @param {{userId: string, role: string, studentId: string|null}} args.actor
 * @param {import("../types/observation.types").IncomingEventDTO} args.input
 * @param {{ipAddress: string|null, userAgent: string|null}} args.requestContext
 */
const ingestEvent = async ({ actor, input, requestContext }) => {
  const targetStudentId = resolveTargetStudentId(actor, input.studentId);

  const normalized = normalizeEvent({ input, studentId: targetStudentId, requestContext });

  return persistNormalizedEvent(normalized);
};

/**
 * Persists an already-normalized event, updates StudentActivityState, and
 * publishes to the bus. Shared tail of both the HTTP path (ingestEvent,
 * which authorizes an external actor first) and the in-process path
 * (recordInternalEvent, called directly by trusted backend modules).
 */
const persistNormalizedEvent = async (normalized) => {
  const event = await learningEventRepository.create(normalized);

  // State update and downstream publishing must never take the write path
  // down — an event that was successfully stored has already fulfilled
  // this agent's core contract.
  try {
    await studentStateService.updateStateFromEvent(event);
  } catch (error) {
    console.error("[observation] failed to update StudentActivityState:", error);
  }

  observationBus.publish(OBSERVATION_EVENT_NAMES.EVENT_CREATED, event);

  return toEventResponse(event);
};

/**
 * Entry point for other backend modules (auth.service, quiz.service, ...)
 * to record an event in-process, with no HTTP round-trip and no actor
 * authorization — the caller IS trusted server code and must supply a
 * concrete studentId itself. Still goes through the same normalization,
 * persistence, state update, and publish path as the HTTP route.
 *
 * @param {import("../types/observation.types").IncomingEventDTO & {studentId: string}} input
 */
const recordInternalEvent = async (input) => {
  if (!input.studentId) {
    throw new ApiError(400, "studentId is required to record an internal event");
  }

  const { error, value } = createEventSchema.validate(input, {
    abortEarly: true,
    stripUnknown: true,
  });

  if (error) {
    throw new ApiError(400, `Invalid internal event payload: ${error.details[0].message}`);
  }

  const normalized = normalizeEvent({ input: value, studentId: input.studentId, requestContext: {} });
  return persistNormalizedEvent(normalized);
};

/**
 * Trusted server-to-server read: a student's full event history in
 * chronological order, no actor authorization, no pagination. For
 * consumers that fold over the whole log (e.g. the Student State Agent's
 * event-sourced recalculate) — not for anything client-facing.
 *
 * @param {string} studentId
 */
const getStudentEventLog = (studentId) => {
  return learningEventRepository.findAllByStudentChronological(studentId);
};

/**
 * Trusted server-to-server read: a single event by id, no actor
 * authorization. For consumers that re-trigger processing of one already-
 * recorded event (e.g. the Assessment Agent's POST /assessment/evaluate).
 *
 * @param {string} eventId
 */
const getEventById = (eventId) => {
  return learningEventRepository.findById(eventId);
};

const getEventsByStudent = async ({ actor, studentId, filters }) => {
  const targetStudentId = resolveTargetStudentId(actor, studentId);
  const { skip, take, page, limit } = clampPagination(filters.page, filters.limit);

  const where = {
    eventType: filters.eventType || undefined,
    eventCategory: filters.eventCategory || undefined,
    courseId: filters.courseId || undefined,
    createdAt: buildCreatedAtFilter(filters.startDate, filters.endDate),
  };

  const [events, total] = await Promise.all([
    learningEventRepository.findByStudent({ studentId: targetStudentId, where, skip, take }),
    learningEventRepository.countByStudent({ studentId: targetStudentId, where }),
  ]);

  return {
    data: toEventListResponse(events),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
};

const getEventsByCourse = async ({ actor, courseId, filters }) => {
  if (!isStaff(actor.role)) {
    throw new ApiError(403, "Only staff can view course-wide learning events");
  }

  const { skip, take, page, limit } = clampPagination(filters.page, filters.limit);

  const where = {
    eventType: filters.eventType || undefined,
    eventCategory: filters.eventCategory || undefined,
    createdAt: buildCreatedAtFilter(filters.startDate, filters.endDate),
  };

  const [events, total] = await Promise.all([
    learningEventRepository.findByCourse({ courseId, where, skip, take }),
    learningEventRepository.countByCourse({ courseId, where }),
  ]);

  return {
    data: toEventListResponse(events),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
};

const getEventsBySession = async ({ actor, sessionId, filters }) => {
  const { skip, take, page, limit } = clampPagination(filters.page, filters.limit);

  const events = await learningEventRepository.findBySession({ sessionId, skip, take });

  if (actor.role === "STUDENT") {
    const belongsToOthers = events.some((event) => event.studentId !== actor.studentId);
    if (belongsToOthers) {
      throw new ApiError(403, "Students may only access their own sessions");
    }
  }

  const total = await learningEventRepository.countBySession({ sessionId });

  return {
    data: toEventListResponse(events),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
  };
};

const getToday = async ({ actor, studentId }) => {
  const targetStudentId = resolveTargetStudentId(actor, studentId);
  const { startOfDay, endOfDay } = getTodayRange();

  const events = await learningEventRepository.findToday({
    studentId: targetStudentId,
    startOfDay,
    endOfDay,
  });

  return toEventListResponse(events);
};

const getStatistics = async ({ actor, studentId, courseId, startDate, endDate }) => {
  let resolvedStudentId;

  if (actor.role === "STUDENT") {
    resolvedStudentId = resolveTargetStudentId(actor, studentId);
  } else if (studentId) {
    resolvedStudentId = studentId;
  }
  // Staff omitting studentId gets platform/course-wide statistics.

  const where = {
    studentId: resolvedStudentId || undefined,
    courseId: courseId || undefined,
    createdAt: buildCreatedAtFilter(startDate, endDate),
  };

  const [totalEvents, totalSessions, byType, byCategory] = await Promise.all([
    learningEventRepository.totalCount(where),
    learningEventRepository.countDistinctSessions(where),
    learningEventRepository.groupCountByType(where),
    learningEventRepository.groupCountByCategory(where),
  ]);

  return toStatisticsResponse({ totalEvents, totalSessions, byType, byCategory });
};

module.exports = {
  ingestEvent,
  recordInternalEvent,
  getStudentEventLog,
  getEventById,
  getEventsByStudent,
  getEventsByCourse,
  getEventsBySession,
  getToday,
  getStatistics,
  // Exported for unit testing — pure, side-effect-free authorization/pagination logic.
  resolveTargetStudentId,
  clampPagination,
};
