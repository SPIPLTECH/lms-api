const prisma = require("../../config/database");

const getAdminDashboard = async () => {
  const totalUsers = await prisma.user.count();

  const totalStudents =
    await prisma.user.count({
      where: { role: "STUDENT" }
    });

  const totalInstructors =
    await prisma.user.count({
      where: { role: "INSTRUCTOR" }
    });

  const activeUsers =
    await prisma.user.count({
      where: { status: "ACTIVE" }
    });

  const blockedUsers =
    await prisma.user.count({
      where: { status: "BLOCKED" }
    });

  const totalCourses =
    await prisma.course.count();

  const publishedCourses =
    await prisma.course.count({
      where: {
        status: "PUBLISHED"
      }
    });

  const draftCourses =
    await prisma.course.count({
      where: {
        status: "DRAFT"
      }
    });

  const totalEnrollments =
    await prisma.enrollment.count();

  const recentUsers =
    await prisma.user.findMany({
      take: 5,
      orderBy: {
        createdAt: "desc"
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true
      }
    });

  return {
    totalUsers,
    totalStudents,
    totalInstructors,
    activeUsers,
    blockedUsers,
    totalCourses,
    publishedCourses,
    draftCourses,
    totalEnrollments,
    recentUsers
  };
};

const getInstructorDashboard =
  async (instructorId) => {
    const myCourses =
      await prisma.course.findMany({
        where: {
          creatorId: instructorId
        },
        select: {
          id: true,
          status: true
        }
      });

    const courseIds =
      myCourses.map(c => c.id);

    const totalCourses =
      myCourses.length;

    const publishedCourses =
      myCourses.filter(
        c => c.status === "PUBLISHED"
      ).length;

    const draftCourses =
      myCourses.filter(
        c => c.status === "DRAFT"
      ).length;

    const totalStudents =
      await prisma.enrollment.count({
        where: {
          courseId: {
            in: courseIds
          }
        }
      });

    const totalModules =
      await prisma.module.count({
        where: {
          courseId: {
            in: courseIds
          }
        }
      });

    const totalQuizzes =
      await prisma.quiz.count({
        where: {
          courseId: {
            in: courseIds
          }
        }
      });

    return {
      totalCourses,
      publishedCourses,
      draftCourses,
      totalStudents,
      totalModules,
      totalQuizzes
     };
  };
const getStudentDashboard = async (userId) => {
  const student = await prisma.studentProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      enrollments: {
        include: {
          course: {
            include: {
              creator: {
                select: {
                  name: true,
                  email: true,
                },
              },
              modules: {
                include: {
                  lessons: true,
                },
              },
            },
          },
        },
      },
      certificates: {
        include: {
          course: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      },
      reviews: {
        include: {
          course: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      },
    },
  });

  if (!student) {
    throw new Error("Student not found");
  }

  const studentId = student.id;

  const progress = await prisma.progress.findMany({
    where: { studentId },
    include: {
      lesson: {
        select: {
          id: true,
          title: true,
          module: {
            select: {
              courseId: true,
            },
          },
        },
      },
    },
  });

  // Total lessons from all enrolled courses
  const totalLessons = student.enrollments.reduce(
    (courseTotal, enrollment) =>
      courseTotal +
      enrollment.course.modules.reduce(
        (moduleTotal, module) =>
          moduleTotal + module.lessons.length,
        0
      ),
    0
  );

  const completedLessons = progress.filter(
    (p) => p.completed
  ).length;

  const completionRate =
    totalLessons === 0
      ? 0
      : Math.round(
          (completedLessons / totalLessons) * 100
        );

  // Format enrolled courses for frontend
  const enrolledCoursesList = student.enrollments.map(
    (enrollment) => {
      const totalCourseLessons =
        enrollment.course.modules.reduce(
          (sum, module) =>
            sum + module.lessons.length,
          0
        );

      const completedCourseLessons =
        progress.filter(
          (p) =>
            p.completed &&
            p.lesson.module.courseId ===
              enrollment.course.id
        ).length;

      const progressPercent =
        totalCourseLessons === 0
          ? 0
          : Math.round(
              (completedCourseLessons /
                totalCourseLessons) *
                100
            );

      return {
        id: enrollment.id,
        courseId: enrollment.courseId,
        enrolledAt: enrollment.enrolledAt,
        studentId: enrollment.studentId,

        course: {
          id: enrollment.course.id,
          title: enrollment.course.title,
          description:
            enrollment.course.description,
          category:
            enrollment.course.category,
          level: enrollment.course.level,
          thumbnailUrl:
            enrollment.course.thumbnailUrl,
          instructor:
            enrollment.course.creator?.name ||
            "Unknown",
          lessons: totalCourseLessons,
        },

        completedLessons:
          completedCourseLessons,
        progress: progressPercent,
      };
    }
  );

  return {
    stats: {
      enrolledCourses:
        student.enrollments.length,
      completedLessons,
      certificates:
        student.certificates.length,
      reviews: student.reviews.length,
      completionRate,
    },

    enrolledCoursesList,
    certificatesList: student.certificates,
    reviewsList: student.reviews,
    progressList: progress,
  };
};

module.exports = {
  getAdminDashboard,
  getInstructorDashboard,
  getStudentDashboard
};