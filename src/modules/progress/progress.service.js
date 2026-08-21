const prisma = require("../../config/database");
const notificationService = require("../notifications/notification.service");
const ApiError = require("../../utils/ApiError");
const { buildLessonLockMap } = require("../../utils/dripAccess");

const completeLesson = async (
  studentId,
  lessonId
) => {
  const lesson =
    await prisma.lesson.findUnique({
      where: {
        id: lessonId
      },
      include: {
        module: true
      }
    });

  if (!lesson) {
    throw new ApiError(404, "Lesson not found");
  }

  const courseId =
    lesson.module.courseId;

  const lockMap = await buildLessonLockMap(courseId, studentId);
  if (lockMap.get(lessonId)) {
    throw new ApiError(403, "Complete the previous lesson first to unlock this one.");
  }

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
      const certificate = await prisma.certificate.create({
        data: {
          certificateNo:
            `CERT-${Date.now()}`,
          studentId,
          courseId
        },
        include: {
          student: {
            select: {
              userId: true
            }
          },
          course: {
            select: {
              title: true
            }
          }
        }
      });

      try {
        await notificationService.createNotification(certificate.student.userId, {
          title: "Course Completed! 🎓",
          message: `Congratulations! You have completed all lessons in the course "${certificate.course.title}". Your certificate is ready!`,
          type: "CERTIFICATE",
          link: `/certificates`
        });
      } catch (error) {
        console.error("Error creating certificate notification:", error.message);
      }
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