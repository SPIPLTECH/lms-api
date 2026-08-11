const prisma = require("../../config/database");
const notificationService = require("../notifications/notification.service");
const ApiError = require("../../utils/ApiError");
// const verifyToken = require(
//   "../../middleware/auth.middleware"
// );


const getCourses = async (
  role,
  search = "",
  page = 1,
  limit = 10
) => {
  const query = {
    where: {
      title: {
        contains: search,
        mode: "insensitive",
      },
    },
    skip: (page - 1) * limit,
    take: limit,
    orderBy: {
      createdAt: "desc",
    },
  };
  // Student should see only published courses


  const commonInclude = {
    creator: {
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        teacherProfile: true,
        adminProfile: true,
      },
    },
    modules: {
      include: {
        lessons: true,
      },
    },
    quizzes: true,
    assignments: true,
    reviews: true,
    certificates: true,
    _count: {
      select: {
        enrollments: true,
        modules: true,
        quizzes: true,
        assignments: true,
        reviews: true,
      },
    },
  };

  if (role === "ADMIN" || role === "INSTRUCTOR") {
    query.include = commonInclude;
  } else {
    query.where.status = "PUBLISHED";
    query.include = commonInclude;
  }
  return await prisma.course.findMany(query);
};

const getCourseById = async (courseId, role) => {
  const isStudentOrGuest = role === "STUDENT" || role === "GUEST";

  const course = await prisma.course.findUnique({
    where: {
      id: courseId
    },
    include: {
      creator: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          teacherProfile: true,
          adminProfile: true
        }
      },

      modules: {
        where: isStudentOrGuest ? { isPublished: true } : undefined,
        orderBy: {
          order: "asc"
        },
        include: {
          lessons: {
            where: isStudentOrGuest ? { isPublished: true } : undefined,
            orderBy: {
              order: "asc"
            },
            include: {
              contents: true
            }
          }
        }
      },

      quizzes: {
        include: {
          questions: true
        }
      },
      enrollments: true
    }
  });

  if (!course) return null;

  if (isStudentOrGuest && course.status !== "PUBLISHED") {
    return null;
  }

  return course;
};

const createCourse = async (data, userId) => {
  return await prisma.course.create({
    data: {
      ...data,
      creatorId: userId
    }
  });
};

const updateCourse = async (courseId, data) => {
  return await prisma.course.update({
    where: {
      id: courseId
    },
    data
  });
};

const updateStatus = async (courseId, status) => {
  if (status === "PUBLISHED") {
    const moduleCount = await prisma.module.count({ where: { courseId } });
    if (moduleCount === 0) {
      throw new ApiError(400, "Add at least one module before publishing this course.");
    }
  }

  const course = await prisma.course.update({
    where: {
      id: courseId
    },
    data: {
      status
    }
  });

  try {
    await notificationService.createNotification(course.creatorId, {
      title: "Course Status Updated 📢",
      message: `Your course "${course.title}" status has been updated to "${status}".`,
      type: "COURSE_STATUS",
      link: `/courses/${courseId}`
    });
  } catch (error) {
    console.error("Error creating course status notification:", error.message);
  }

  return course;
};

const deleteCourse = async (courseId) => {
  return await prisma.course.delete({
    where: {
      id: courseId
    }
  });
};

const getCourseStudents = async (courseId) => {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      courseId
    },
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
      }
    }
  });

  return enrollments.map((enrollment) => ({
    id: enrollment.student.user.id,
    name: enrollment.student.user.name,
    email: enrollment.student.user.email,
    enrolledAt: enrollment.enrolledAt
  }));
};

const getCourseBatches = async (courseId) => {
  return await prisma.batch.findMany({
    where: { courseId },
    orderBy: { createdAt: "desc" }
  });
};

const createCourseBatch = async (courseId, data) => {
  return await prisma.batch.create({
    data: {
      name: data.name,
      startDate: new Date(data.startDate),
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      startTime: data.startTime || null,
      endTime: data.endTime || null,
      meetingLink: data.meetingLink || null,
      status: data.status || "ACTIVE",
      isPublished: data.isPublished !== undefined ? data.isPublished : true,
      courseId
    }
  });
};

module.exports = {
  getCourses,
  getCourseById,
  createCourse,
  updateCourse,
  updateStatus,
  deleteCourse,
  getCourseStudents,
  getCourseBatches,
  createCourseBatch
};