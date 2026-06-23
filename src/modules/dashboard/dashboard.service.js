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
const getStudentDashboard =
  async (studentId) => {
    const enrolledCourses =
      await prisma.enrollment.count({
        where: {
          userId: studentId
        }
      });

    const completedLessons =
      await prisma.progress.count({
        where: {
          userId: studentId,
          completed: true
        }
      });

    const totalProgress =
      await prisma.progress.count({
        where: {
          userId: studentId
        }
      });

    const certificates =
      await prisma.certificate.count({
        where: {
          userId: studentId
        }
      });

    const completionRate =
      totalProgress === 0
        ? 0
        : Math.round(
            (completedLessons /
              totalProgress) *
              100
          );

    return {
      enrolledCourses,
      completedLessons,
      certificates,
      completionRate
    };
  };

module.exports = {
  getAdminDashboard,
  getInstructorDashboard,
  getStudentDashboard
};