import { prisma } from "../config/database";

export const getStudentAnalytics = async (
  userId: string
) => {

  const enrolledCourses =
    await prisma.enrollment.count({
      where: { userId },
    });

  const quizAttempts =
    await prisma.quizAttempt.count({
      where: { userId },
    });

  const certificates =
    await prisma.certificate.count({
      where: { userId },
    });

  return {
    enrolledCourses,
    quizAttempts,
    certificates,
  };
};

export const getTeacherAnalytics =
  async (teacherId: string) => {

    const courses =
      await prisma.course.count({
        where: {
          teacherId,
        },
      });

    return {
      courses,
    };
  };

export const getAdminAnalytics =
  async () => {

    const users =
      await prisma.user.count();

    const courses =
      await prisma.course.count();

    const enrollments =
      await prisma.enrollment.count();

    return {
      users,
      courses,
      enrollments,
    };
  };