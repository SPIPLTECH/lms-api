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

  const { lockMap } = await buildLessonLockMap(courseId, studentId);
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

// Records that a student has visited one or more Content rows (a video
// watched to the end, or a document/file/link block scrolled into view on
// the frontend — see contentDocument.js for why a single displayed block
// can map to several underlying Content ids). Once every Content row under
// a lesson has been visited, the lesson auto-completes via the exact same
// completeLesson() path the manual "Mark Complete" button uses, so
// certificate issuance and percentage math are never duplicated.
const markContentVisited = async (
  studentId,
  contentIds
) => {
  const contents = await prisma.content.findMany({
    where: { id: { in: contentIds } },
    select: { id: true, topic: { select: { lessonId: true } } }
  });

  if (contents.length === 0) {
    throw new ApiError(404, "Content not found");
  }

  const lessonId = contents[0].topic.lessonId;

  await prisma.$transaction(
    contents.map((content) =>
      prisma.contentProgress.upsert({
        where: {
          studentId_contentId: { studentId, contentId: content.id }
        },
        update: {},
        create: { studentId, contentId: content.id }
      })
    )
  );

  const lessonContents = await prisma.content.findMany({
    where: { topic: { lessonId } },
    select: { id: true }
  });
  const lessonContentIds = lessonContents.map((c) => c.id);

  const visitedCount = await prisma.contentProgress.count({
    where: { studentId, contentId: { in: lessonContentIds } }
  });

  const allContentVisited =
    lessonContentIds.length > 0 && visitedCount === lessonContentIds.length;

  let lessonCompleted = false;
  if (allContentVisited) {
    try {
      await completeLesson(studentId, lessonId);
      lessonCompleted = true;
    } catch (error) {
      // Drip-locked or otherwise not completable yet — visiting content
      // still gets recorded above, it just doesn't force completion.
      lessonCompleted = false;
    }
  }

  return { lessonId, allContentVisited, lessonCompleted };
};

const getAllCoursesProgress = async (
  studentId
) => {
  const enrollments =
    await prisma.enrollment.findMany({
      where: { studentId },
      select: {
        course: {
          select: {
            id: true,
            title: true,
            creator: { select: { name: true } },
            modules: {
              select: {
                lessons: { select: { id: true } }
              }
            }
          }
        }
      }
    });

  const courseIds = enrollments.map((e) => e.course.id);

  const completedProgress = courseIds.length
    ? await prisma.progress.findMany({
        where: {
          studentId,
          completed: true,
          lesson: { module: { courseId: { in: courseIds } } }
        },
        select: {
          lesson: { select: { module: { select: { courseId: true } } } }
        }
      })
    : [];

  const completedByCourse = new Map();
  for (const p of completedProgress) {
    const cid = p.lesson.module.courseId;
    completedByCourse.set(cid, (completedByCourse.get(cid) || 0) + 1);
  }

  const courses = enrollments.map(({ course }) => {
    const totalLessons = course.modules.reduce(
      (sum, m) => sum + m.lessons.length,
      0
    );
    const completedLessons = completedByCourse.get(course.id) || 0;
    const progress =
      totalLessons === 0
        ? 0
        : Math.round((completedLessons / totalLessons) * 100);

    return {
      id: course.id,
      title: course.title,
      instructor: course.creator?.name || "Unknown",
      completedLessons,
      totalLessons,
      progress
    };
  });

  const totalLessons = courses.reduce((sum, c) => sum + c.totalLessons, 0);
  const completedLessons = courses.reduce((sum, c) => sum + c.completedLessons, 0);
  const percentage =
    totalLessons === 0
      ? 0
      : Math.round((completedLessons / totalLessons) * 100);

  return { totalLessons, completedLessons, percentage, courses };
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
  markContentVisited,
  getAllCoursesProgress,
  getCourseProgress
};