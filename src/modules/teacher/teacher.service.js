const prisma = require("../../config/database");

const getTeachers = async () => {
  return await prisma.teacherProfile.findMany({
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true
        }
      }
    }
  });
};

const getTeacherById = async (teacherId) => {
  const teacher = await prisma.teacherProfile.findUnique({
    where: {
      id: teacherId
    },
    include: {
      user: {
        include: {
          courses: true
        }
      }
    }
  });

  if (!teacher) {
    const error = new Error("Teacher not found");
    error.statusCode = 404;
    throw error;
  }

  return teacher;
};

const updateTeacher = async (teacherId, data) => {
  const existing = await prisma.teacherProfile.findUnique({
    where: {
      id: teacherId
    }
  });

  if (!existing) {
    const error = new Error("Teacher not found");
    error.statusCode = 404;
    throw error;
  }

  return await prisma.teacherProfile.update({
    where: {
      id: teacherId
    },
    data
  });
};

const getTeacherCourses = async (teacherId) => {
  return await prisma.course.findMany({
    where: {
      creatorId: teacherId
    }
  });
};

module.exports = {
  getTeachers,
  getTeacherById,
  updateTeacher,
  getTeacherCourses
};

