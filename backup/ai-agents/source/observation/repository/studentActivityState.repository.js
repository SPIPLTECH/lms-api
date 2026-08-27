const prisma = require("../../../config/database");

/**
 * Pure data-access layer for StudentActivityState — the single-row-per-student
 * "current pointer" the service upserts after every ingested event.
 */

const upsertFromEvent = ({ studentId, event, isNewSession }) => {
  const pointerFields = {
    lastEventType: event.eventType,
    lastEventCategory: event.eventCategory,
    lastSessionId: event.sessionId,
    lastCourseId: event.courseId ?? null,
    lastModuleId: event.moduleId ?? null,
    lastLessonId: event.lessonId ?? null,
    lastActiveAt: event.createdAt,
  };

  return prisma.studentActivityState.upsert({
    where: { studentId },
    create: {
      studentId,
      totalEventsCount: 1,
      totalSessionsCount: isNewSession ? 1 : 0,
      ...pointerFields,
    },
    update: {
      totalEventsCount: { increment: 1 },
      totalSessionsCount: isNewSession ? { increment: 1 } : undefined,
      ...pointerFields,
    },
  });
};

const findByStudent = (studentId) => {
  return prisma.studentActivityState.findUnique({ where: { studentId } });
};

module.exports = {
  upsertFromEvent,
  findByStudent,
};
