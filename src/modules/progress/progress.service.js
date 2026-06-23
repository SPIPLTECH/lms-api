// const prisma = require("../../config/database");

const prisma = require("../../config/database");

const completeLesson = async (
  userId,
  lessonId
) => {

  const progress =
    await prisma.progress.upsert({
      where: {
        userId_lessonId: {
          userId,
          lessonId
        }
      },
      update: {
        completed: true,
        completedAt: new Date()
      },
      create: {
        userId,
        lessonId,
        completed: true,
        completedAt: new Date()
      }
    });

  // Get lesson
  const lesson =
    await prisma.lesson.findUnique({
      where: {
        id: lessonId
      },
      include: {
        module: true
      }
    });

  const courseId =
    lesson.module.courseId;

  // Get all lessons in course
  const lessons =
    await prisma.lesson.findMany({
      where: {
        module: {
          courseId
        }
      },
      select: {
        id: true
      }
    });

  const lessonIds =
    lessons.map(
      (lesson) => lesson.id
    );

  const completedLessons =
    await prisma.progress.count({
      where: {
        userId,
        lessonId: {
          in: lessonIds
        },
        completed: true
      }
    });

  const totalLessons =
    lessons.length;

  const percentage =
    totalLessons === 0
      ? 0
      : Math.round(
          (completedLessons /
            totalLessons) *
            100
        );

  // Generate certificate automatically
  if (percentage === 100) {

    const existingCertificate =
      await prisma.certificate.findFirst({
        where: {
          userId,
          courseId
        }
      });

    if (!existingCertificate) {

      await prisma.certificate.create({
        data: {
          certificateNo:
            `CERT-${Date.now()}`,
          userId,
          courseId
        }
      });

    }
  }

  return progress;
};

const getCourseProgress = async (
  userId,
  courseId
) => {
  const lessons =
    await prisma.lesson.findMany({
      where: {
        module: {
          courseId
        }
      },
      select: {
        id: true
      }
    });

  const lessonIds = lessons.map(
    (lesson) => lesson.id
  );

  const completedLessons =
    await prisma.progress.count({
      where: {
        userId,
        lessonId: {
          in: lessonIds
        },
        completed: true
      }
    });

  const totalLessons =
    lessons.length;

  const percentage =
    totalLessons === 0
      ? 0
      : Math.round(
          (completedLessons /
            totalLessons) *
            100
        );

  return {
    totalLessons,
    completedLessons,
    percentage
  };
};

module.exports = {
  completeLesson,
  getCourseProgress
};