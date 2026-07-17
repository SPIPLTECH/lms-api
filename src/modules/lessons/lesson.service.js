const prisma =
  require("../../config/database");
const notificationService = require("../notifications/notification.service");

const getLessons = async (moduleId, role) => {
  const where =
    (role === "STUDENT" || role === "GUEST")
      ? {
          moduleId,
          isPublished: true,
        }
      : {
          moduleId,
        };

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
  const lesson = await prisma.lesson.create({
    data
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

const reorderLessons = async (
  lessons
) => {
  return prisma.$transaction(
    lessons.map((lesson) =>
      prisma.lesson.update({
        where: {
          id: lesson.lessonId
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
  reorderLessons
};