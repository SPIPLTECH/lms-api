const prisma = require("../../config/database");

const completeLesson = async (
  studentId,
  lessonId
) => {
  const progress =
    await prisma.progress.upsert({
      where: {
        studentId_lessonId: {
          studentId,
          lessonId
        }
      },
      update: {
        completed: true,
        completedAt: new Date()
      },
      create: {
        studentId,
        lessonId,
        completed: true,
        completedAt: new Date()
      }
    });

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
        studentId,
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

  if (percentage === 100) {
    const existingCertificate =
      await prisma.certificate.findFirst({
        where: {
          studentId,
          courseId
        }
      });

    if (!existingCertificate) {
      await prisma.certificate.create({
        data: {
          certificateNo:
            `CERT-${Date.now()}`,
          studentId,
          courseId
        }
      });
    }
  }

  return progress;
};

const getCourseProgress = async (
  studentId,
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

  const lessonIds =
    lessons.map(
      (lesson) => lesson.id
    );

  const completedLessons =
    await prisma.progress.count({
      where: {
        studentId,
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