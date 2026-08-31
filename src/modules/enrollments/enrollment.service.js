const prisma = require("../../config/database");
const notificationService = require("../notifications/notification.service");

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

const ApiError = require("../../utils/ApiError");

const createEnrollment = async (
  studentId,
  courseId
) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, status: true }
  });

  if (!course) {
    throw new ApiError(404, "Course not found");
  }

  if (course.status !== "PUBLISHED") {
    throw new ApiError(400, "This course is not open for enrollment.");
  }

  const existing =
    await prisma.enrollment.findFirst({
      where: {
        studentId,
        courseId
      }
    });

  if (existing) {
    throw new ApiError(400, "Already enrolled in this course");
  }

  const enrollment = await prisma.enrollment.create({
    data: {
      studentId,
      courseId
    },
    include: {
      student: {
        include: {
          user: {
            select: {
              name: true
            }
          }
        }
      },
      course: {
        select: {
          title: true,
          creatorId: true
        }
      }
    }
  });

  try {
    await notificationService.createNotification(enrollment.course.creatorId, {
      title: "New Student Enrolled 🎓",
      message: `${enrollment.student.user.name} enrolled in your course "${enrollment.course.title}".`,
      type: "ENROLLMENT",
      link: `/courses/${courseId}/students`
    });
  } catch (error) {
    console.error("Error creating enrollment notification:", error.message);
  }

  return enrollment;
};

const deleteEnrollment = async (
  enrollmentId
) => {
  const existing = await prisma.enrollment.findUnique({ where: { id: enrollmentId } });
  if (!existing) {
    const error = new Error("Enrollment not found");
    error.statusCode = 404;
    throw error;
  }

  return await prisma.enrollment.delete({
    where: {
      id: enrollmentId
    }
  });
};

const updateLastAccessed = async (
  studentId,
  courseId
) => {
  return await prisma.enrollment.update({
    where: {
      studentId_courseId: {
        studentId,
        courseId
      }
    },
    data: {
      lastAccessedAt: new Date()
    }
  });
};

module.exports = {
  getEnrollments,
  createEnrollment,
  deleteEnrollment,
  updateLastAccessed
};