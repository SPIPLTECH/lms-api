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
  return await prisma.teacherProfile.findUnique({
    where: {
      id: teacherId
    },
    include: {
      user: true,
      courses: true
    }
  });
};

const updateTeacher = async (teacherId, data) => {
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

