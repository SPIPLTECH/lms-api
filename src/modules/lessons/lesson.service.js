const prisma =
  require("../../config/database");
const ApiError = require("../../utils/ApiError");
const { claimSequenceOrder, releaseSequenceOrder } = require("../contents/contentOrder.util");
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
      topics: {
        orderBy: {
          order: "asc"
        },
        include: {
          contents: {
            orderBy: {
              order: "asc"
            }
          },
          // Nested under Topic, so a lesson with no SubTopics returns exactly
          // what it did before plus an empty `subTopics` array.
          subTopics: {
            orderBy: { order: "asc" },
            include: {
              contents: { orderBy: { order: "asc" } },
              concepts: {
                orderBy: { order: "asc" },
                include: { contents: { orderBy: { order: "asc" } } }
              }
            }
          }
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
  data,
  actorUserId = null
) => {
  // A lesson added to an already-published course goes live with it.
  const parentModule = await prisma.module.findUnique({
    where: { id: data.moduleId },
    select: { course: { select: { status: true } } }
  });

  // Appended to the module's ONE common sequence — after the module's last
  // Content, Quiz, Assignment or Lesson.
  const lesson = await prisma.$transaction(async (tx) => {
    const order = await claimSequenceOrder("moduleId", data.moduleId, null, tx, "lesson");
    return tx.lesson.create({
      data: {
        ...data,
        order,
        isPublished: data.isPublished ?? parentModule?.course?.status === "PUBLISHED"
      }
    });
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
      notificationService.notifyEnrolledStudents(
        moduleRecord.courseId,
        {
          title: "New Lesson Published 📚",
          message: `A new lesson "${lesson.title}" has been added to your course "${moduleRecord.course.title}".`,
          type: "LESSON_PUBLISHED",
          link: `/courses/${moduleRecord.courseId}`,
          actorId: actorUserId
        },
        null,
        `lesson_published_${lesson.id}`,
        actorUserId
      ).catch(err => console.error("Error sending lesson notification:", err.message));
    }
  }

  return lesson;
};

const updateLesson = async (
  lessonId,
  data,
  actorUserId = null
) => {
  const oldLesson = await prisma.lesson.findUnique({
    where: { id: lessonId }
  });

  if (!oldLesson) {
    const error = new Error("Lesson not found");
    error.statusCode = 404;
    throw error;
  }

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
      notificationService.notifyEnrolledStudents(
        moduleRecord.courseId,
        {
          title: "New Lesson Published 📚",
          message: `A new lesson "${lesson.title}" has been added to your course "${moduleRecord.course.title}".`,
          type: "LESSON_PUBLISHED",
          link: `/courses/${moduleRecord.courseId}`,
          actorId: actorUserId
        },
        null,
        `lesson_published_${lesson.id}`,
        actorUserId
      ).catch(err => console.error("Error sending lesson notification:", err.message));
    }
  }

  return lesson;
};

const deleteLesson = async (
  lessonId
) => {
  const existing = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      topics: {
        select: {
          id: true,
          subTopics: { select: { id: true, concepts: { select: { id: true } } } }
        }
      }
    }
  });

  if (!existing) {
    const error = new Error("Lesson not found");
    error.statusCode = 404;
    throw error;
  }

  const topicIds = (existing.topics || []).map((t) => t.id);
  const subTopics = (existing.topics || []).flatMap((t) => t.subTopics || []);
  const subTopicIds = subTopics.map((s) => s.id);
  const conceptIds = subTopics.flatMap((s) => (s.concepts || []).map((c) => c.id));

  return await prisma.$transaction(async (tx) => {
    // 1. Delete every quiz at or below this lesson. Descendant rows cascade
    //    in the database, but Quiz does not cascade to QuizQuestion or
    //    QuizSubmission, so SubTopic/Concept quizzes must be cleared here too.
    const quizzesToDelete = await tx.quiz.findMany({
      where: {
        OR: [
          { lessonId },
          ...(topicIds.length > 0 ? [{ topicId: { in: topicIds } }] : []),
          ...(subTopicIds.length > 0 ? [{ subTopicId: { in: subTopicIds } }] : []),
          ...(conceptIds.length > 0 ? [{ conceptId: { in: conceptIds } }] : [])
        ]
      },
      select: { id: true }
    });

    const quizIds = quizzesToDelete.map((q) => q.id);

    if (quizIds.length > 0) {
      await tx.quizQuestion.deleteMany({ where: { quizId: { in: quizIds } } });
      await tx.quizSubmission.deleteMany({ where: { quizId: { in: quizIds } } });
      await tx.quiz.deleteMany({ where: { id: { in: quizIds } } });
    }

    // 2. Delete contents and containers, deepest first
    if (conceptIds.length > 0) {
      await tx.content.deleteMany({ where: { conceptId: { in: conceptIds } } });
      await tx.concept.deleteMany({ where: { id: { in: conceptIds } } });
    }
    if (subTopicIds.length > 0) {
      await tx.content.deleteMany({ where: { subTopicId: { in: subTopicIds } } });
      await tx.subTopic.deleteMany({ where: { id: { in: subTopicIds } } });
    }
    if (topicIds.length > 0) {
      await tx.content.deleteMany({ where: { topicId: { in: topicIds } } });
      await tx.topic.deleteMany({ where: { id: { in: topicIds } } });
    }

    // 3. Delete lesson
    const deleted = await tx.lesson.delete({
      where: {
        id: lessonId
      }
    });

    // 4. Close the lesson's slot in its module's common sequence
    await releaseSequenceOrder("moduleId", existing.moduleId, existing.order, tx);
    return deleted;
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

      try {
        const segments = await youtubeTranscript.fetchTranscript(videoId);
        return { videoId, segments };
      } catch (err) {
        console.warn(`Could not fetch YouTube transcript for videoId ${videoId}:`, err.message);
        return { videoId, segments: [] };
      }
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

  const videoContent = lesson.topics
    .flatMap((topic) => topic.contents || [])
    .concat(lesson.contents || [])
    .find(
      (content) =>
        content.type === "VIDEO" &&
        content.videoUrl
    );

  if (!videoContent) {
    return {
      lessonId,
      videoId: null,
      segments: []
    };
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
  // Verify every id actually belongs to this module before touching anything,
  // so a caller who owns moduleId can't smuggle in another module's lesson id.
  const existing = await prisma.lesson.findMany({
    where: { moduleId },
    select: { id: true }
  });
  const validIds = new Set(existing.map((lesson) => lesson.id));
  const allBelongToModule = lessons.every((lesson) => validIds.has(lesson.id));
  if (!allBelongToModule) {
    throw new ApiError(403, "One or more lessons do not belong to this module.");
  }

  // Two-phase reorder: @@unique([moduleId, order]) rejects a naive
  // parallel swap (A->2 while B still holds 2), so first move every
  // row to a disjoint negative placeholder, then to its final order.
  const offsetUpdates = lessons.map((lesson, index) =>
    prisma.lesson.update({
      where: {
        id: lesson.id
      },
      data: {
        order: -1000 - index
      }
    })
  );
  await prisma.$transaction(offsetUpdates);

  const finalUpdates = lessons.map((lesson) =>
    prisma.lesson.update({
      where: {
        id: lesson.id
      },
      data: {
        order: lesson.order
      }
    })
  );

  return prisma.$transaction(finalUpdates);
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