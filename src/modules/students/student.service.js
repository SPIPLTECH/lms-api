const prisma = require("../../config/database");

const getStudents = async () => {
  return await prisma.studentProfile.findMany({
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

const getStudentById = async (studentId) => {
  return await prisma.studentProfile.findUnique({
    where: {
      id: studentId
    },
    include: {
      user: true,
      enrollments: true,
      certificates: true
    }
  });
};

const updateStudent = async (studentId, data) => {
  return await prisma.studentProfile.update({
    where: {
      id: studentId
    },
    data
  });
};

const getStudentProgress = async (studentId) => {
  const progress = await prisma.progress.findMany({
    where: {
      studentId
    },
    include: {
      lesson: true
    }
  });

  const totalLessons = progress.length;
  const completedLessons = progress.filter(
    (item) => item.completed
  ).length;

  const completionPercentage =
    totalLessons === 0
      ? 0
      : Math.round(
          (completedLessons / totalLessons) * 100
        );

  return {
    totalLessons,
    completedLessons,
    completionPercentage,
    progress
  };
};

module.exports = {
  getStudents,
  getStudentById,
  updateStudent,
  getStudentProgress
};
