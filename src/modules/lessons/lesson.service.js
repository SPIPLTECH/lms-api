const prisma =
  require("../../config/database");
const ApiError = require("../../utils/ApiError");
const notificationService = require("../notifications/notification.service");
const youtubeTranscript = require("../../utils/youtubeTranscript");

const getLessons = async (moduleId, role, userId) => {
  const where = {};

  if (moduleId) {
    where.moduleId = moduleId;
  } else if (role === "INSTRUCTOR") {
    // No specific module requested: scope to this instructor's own courses only.
    where.module = { course: { creatorId: userId } };
  }

  if (role === "STUDENT" || role === "GUEST") {
    where.isPublished = true;
  }

  return prisma.lesson.findMany({
    where,
    orderBy: {
      order: "asc",
    },
  });
};

const getLessonById = async (
  lessonId,
  role
) => {
  const isStudentOrGuest = role === "STUDENT" || role === "GUEST";

  const lesson = await prisma.lesson.findUnique({
    where: {
      id: lessonId
    },
    include: {
      contents: {
        orderBy: {
          order: "asc"
        }
      }
    }
  });

  if (!lesson) return null;

  if (isStudentOrGuest && !lesson.isPublished) {
    return null;
  }

  return lesson;
};

const createLesson = async (
  data
) => {
  const lastLesson = await prisma.lesson.findFirst({
    where: { moduleId: data.moduleId },
    orderBy: { order: "desc" },
    select: { order: true }
  });

  const lesson = await prisma.lesson.create({
    data: { ...data, order: (lastLesson?.order ?? 0) + 1 }
  });

  if (lesson.isPublished) {
    const moduleRecord = await prisma.module.findUnique({
      where: { id: lesson.moduleId },
      include: {
        course: {
          select: {
            title: true
          }
        }
      }
    });

    if (moduleRecord) {
      notificationService.notifyEnrolledStudents(moduleRecord.courseId, {
        title: "New Lesson Published 📚",
        message: `A new lesson "${lesson.title}" has been added to your course "${moduleRecord.course.title}".`,
        type: "LESSON_PUBLISHED",
        link: `/courses/${moduleRecord.courseId}`
      }).catch(err => console.error("Error sending lesson notification:", err.message));
    }
  }

  return lesson;
};

const updateLesson = async (
  lessonId,
  data
) => {
  const oldLesson = await prisma.lesson.findUnique({
    where: { id: lessonId }
  });

  const lesson = await prisma.lesson.update({
    where: {
      id: lessonId
    },
    data
  });

  if (lesson.isPublished && (!oldLesson || !oldLesson.isPublished)) {
    const moduleRecord = await prisma.module.findUnique({
      where: { id: lesson.moduleId },
      include: {
        course: {
          select: {
            title: true
          }
        }
      }
    });

    if (moduleRecord) {
      notificationService.notifyEnrolledStudents(moduleRecord.courseId, {
        title: "New Lesson Published 📚",
        message: `A new lesson "${lesson.title}" has been added to your course "${moduleRecord.course.title}".`,
        type: "LESSON_PUBLISHED",
        link: `/courses/${moduleRecord.courseId}`
      }).catch(err => console.error("Error sending lesson update notification:", err.message));
    }
  }

  return lesson;
};

const deleteLesson = async (
  lessonId
) => {
  return prisma.lesson.delete({
    where: {
      id: lessonId
    }
  });
};

// Resolves the transcript for a lesson's video content. Keyed off
// content.type so additional sources (uploaded captions, AI-generated,
// cached transcripts) can be added here without touching the controller.
const getTranscriptForContent = async (
  content
) => {
  switch (content.type) {
    case "VIDEO": {
      const videoId = youtubeTranscript.extractVideoId(
        content.videoUrl
      );

      if (!videoId) {
        const error = new Error(
          "The lesson video URL is not a valid YouTube link."
        );
        error.statusCode = 400;
        throw error;
      }

      const segments = await youtubeTranscript.fetchTranscript(
        videoId
      );

      return { videoId, segments };
    }

    default: {
      const error = new Error(
        "Transcripts are not supported for this content type."
      );
      error.statusCode = 400;
      throw error;
    }
  }
};

const getLessonTranscript = async (
  lessonId,
  role
) => {
  const lesson = await getLessonById(
    lessonId,
    role
  );

  if (!lesson) {
    const error = new Error(
      "Lesson not found"
    );
    error.statusCode = 404;
    throw error;
  }

  const videoContent = lesson.contents.find(
    (content) =>
      content.type === "VIDEO" &&
      content.videoUrl
  );

  if (!videoContent) {
    const error = new Error(
      "This lesson does not contain any video content."
    );
    error.statusCode = 404;
    throw error;
  }

  const { videoId, segments } =
    await getTranscriptForContent(
      videoContent
    );

  return {
    lessonId,
    videoId,
    segments
  };
};

const reorderLessons = async (
  moduleId,
  lessons
) => {
  // Mirrors reorderModules: the caller's ownership of `moduleId` is verified
  // by middleware before this runs, but every id in the payload must also be
  // confirmed to actually belong to that module before we touch it — a
  // lesson id from a different module (owned by someone else) must not be
  // reorderable just because it was included in this request's array.
  const owned = await prisma.lesson.findMany({
    where: {
      id: { in: lessons.map((lesson) => lesson.id) },
      moduleId
    },
    select: { id: true }
  });

  const ownedIds = new Set(owned.map((lesson) => lesson.id));
  const invalidId = lessons.find((lesson) => !ownedIds.has(lesson.id));

  if (invalidId) {
    throw new ApiError(
      403,
      "Forbidden: one or more lessons do not belong to this module"
    );
  }

  return prisma.$transaction(
    lessons.map((lesson) =>
      prisma.lesson.update({
        where: {
          id: lesson.id
        },
        data: {
          order: lesson.order
        }
      })
    )
  );
};

module.exports = {
  getLessons,
  getLessonById,
  createLesson,
  updateLesson,
  deleteLesson,
  reorderLessons,
  getLessonTranscript
};