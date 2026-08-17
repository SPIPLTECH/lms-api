/**
 * Shapes a LearningEvent row for API responses. Keeps internal-only
 * columns (none currently, but this is the seam to add them later —
 * e.g. an ingestion-debug field) from leaking to clients.
 */
const toEventResponse = (event) => ({
  id: event.id,
  studentId: event.studentId,
  courseId: event.courseId,
  moduleId: event.moduleId,
  lessonId: event.lessonId,
  contentId: event.contentId,
  quizId: event.quizId,
  assignmentId: event.assignmentId,
  sessionId: event.sessionId,
  eventType: event.eventType,
  eventCategory: event.eventCategory,
  payload: event.payload,
  metadata: event.metadata,
  source: event.source,
  clientTimestamp: event.clientTimestamp,
  createdAt: event.createdAt,
});

const toEventListResponse = (events) => events.map(toEventResponse);

module.exports = {
  toEventResponse,
  toEventListResponse,
};
