const prisma = require("../../config/database");

const getEnrollments = async (
  studentId,
  courseId
) => {
  const where = {};

  if (studentId) {
    where.studentId = studentId;
  }

  if (courseId) {
    where.courseId = courseId;
  }

  return await prisma.enrollment.findMany({
    where,
    include: {
      student: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        }
      },
      course: {
        select: {
          id: true,
          title: true,
          description: true
        }
      }
    }
  });
};

const createEnrollment = async (
  studentId,
  courseId
) => {
  const existing =
    await prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId
      }
    });

  if (existing) {
    throw new Error(
      "Already enrolled in this course"
    );
  }

  return await prisma.enrollment.create({
    data: {
      studentId,
      courseId
    }
  });
};

const deleteEnrollment = async (
  enrollmentId
) => {
  return await prisma.enrollment.delete({
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