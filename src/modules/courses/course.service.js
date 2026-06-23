const prisma = require(
  "../../config/database"
);

const getCourses = async (
  search = "",
  page = 1,
  limit = 10
) => {
  return await prisma.course.findMany({
    where: {
      title: {
        contains: search,
        mode: "insensitive"
      }
    },

    skip: (page - 1) * limit,
    take: limit,

    include: {
      creator: {
        select: {
          id: true,
          name: true
        }
      }
    },

    orderBy: {
      createdAt: "desc"
    }
  });
};

const getCourseById = async (
  courseId
) => {
  return await prisma.course.findUnique({
    where: {
      id: courseId
    },

    include: {
      creator: {
        select: {
          id: true,
          name: true,
          email: true
        }
      },

      modules: {
        orderBy: {
          order: "asc"
        },

        include: {
          lessons: {
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
      }
    }
  });
};

const createCourse = async (
  data,
  userId
) => {
  return await prisma.course.create({
    data: {
      ...data,
      creatorId: userId
    }
  });
};

const updateCourse = async (
  courseId,
  data
) => {
  return await prisma.course.update({
    where: {
      id: courseId
    },
    data
  });
};

const updateStatus = async (
  courseId,
  status
) => {
  return await prisma.course.update({
    where: {
      id: courseId
    },
    data: {
      status
    }
  });
};

const deleteCourse = async (
  courseId
) => {
  return await prisma.course.delete({
    where: {
      id: courseId
    }
  });
};
const getCourseStudents = async (
  courseId
) => {
  const enrollments =
    await prisma.enrollment.findMany({
      where: {
        courseId
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

  return enrollments.map(
    (enrollment) => ({
      ...enrollment.user,
      enrolledAt:
        enrollment.enrolledAt
    })
  );
};
module.exports = {
  getCourses,
  getCourseById,
  createCourse,
  updateCourse,
  updateStatus,
  deleteCourse,
  getCourseStudents
};