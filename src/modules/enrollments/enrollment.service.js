const prisma = require("../../config/database");

const getEnrollments = async (
  userId,
  courseId
) => {
  const where = {};

  if (userId) {
    where.userId = userId;
  }

  if (courseId) {
    where.courseId = courseId;
  }

  return prisma.enrollment.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true
        }
      },
      course: {
        select: {
          id: true,
          title: true
        }
      }
    }
  });
};

const createEnrollment = async (
  userId,
  courseId
) => {
  return prisma.enrollment.create({
    data: {
      userId,
      courseId
    }
  });
};

const deleteEnrollment = async (
  enrollmentId
) => {
  return prisma.enrollment.delete({
    where: {
      id: enrollmentId
    }
  });
};

module.exports = {
  getEnrollments,
  createEnrollment,
  deleteEnrollment
};