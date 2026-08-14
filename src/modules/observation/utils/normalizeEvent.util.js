const { resolveCategory } = require("../constants");
const { generateSessionId } = require("./requestContext.util");

/**
 * Turns a validated IncomingEventDTO + resolved actor/context into the
 * exact shape Prisma's LearningEvent.create expects. This is the only
 * place event normalization happens — repository and controller never
 * touch raw client input.
 *
 * @param {import("../types/observation.types")} _
 * @param {object} args
 * @param {object} args.input - validated request body
 * @param {string} args.studentId - resolved target StudentProfile.id
 * @param {object} args.requestContext - { ipAddress, userAgent }
 * @returns {object} Prisma.LearningEventCreateInput-shaped data
 */
const normalizeEvent = ({ input, studentId, requestContext }) => {
  const eventCategory = resolveCategory(input.eventType);
  const sessionId = input.sessionId || generateSessionId();

  return {
    studentId,
    courseId: input.courseId || null,
    moduleId: input.moduleId || null,
    lessonId: input.lessonId || null,
    contentId: input.contentId || null,
    quizId: input.quizId || null,
    assignmentId: input.assignmentId || null,
    sessionId,
    eventType: input.eventType,
    eventCategory,
    payload: input.payload || undefined,
    metadata: input.metadata || undefined,
    source: input.source || null,
    ipAddress: requestContext?.ipAddress || null,
    userAgent: requestContext?.userAgent || null,
    clientTimestamp: input.clientTimestamp ? new Date(input.clientTimestamp) : null,
  };
};

module.exports = { normalizeEvent };
