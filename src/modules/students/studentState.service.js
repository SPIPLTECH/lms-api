const prisma = require("../../config/database");

const getStudentState = async (userId, courseId = null) => {
  const studentProfile = await prisma.studentProfile.findUnique({
    where: { userId }
  });

  if (!studentProfile) {
    return null;
  }

  const where = { studentId: studentProfile.id };
  if (courseId) {
    where.courseId = courseId;
  }

  const state = await prisma.studentState.findFirst({
    where,
    orderBy: { updatedAt: "desc" }
  });

  return state;
};

const updateStudentState = async (userId, data) => {
  const studentProfile = await prisma.studentProfile.findUnique({
    where: { userId }
  });

  if (!studentProfile) {
    const error = new Error("Student profile not found");
    error.statusCode = 404;
    throw error;
  }

  const { courseId, moduleId, lessonId, contentId, timestamp } = data;

  if (!courseId) {
    const error = new Error("courseId is required to update student state");
    error.statusCode = 400;
    throw error;
  }

  const state = await prisma.studentState.upsert({
    where: {
      studentId_courseId: {
        studentId: studentProfile.id,
        courseId
      }
    },
    update: {
      courseId,
      moduleId: moduleId || null,
      lessonId: lessonId || null,
      contentId: contentId || null,
      timestamp: typeof timestamp === "number" ? timestamp : 0
    },
    create: {
      studentId: studentProfile.id,
      courseId,
      moduleId: moduleId || null,
      lessonId: lessonId || null,
      contentId: contentId || null,
      timestamp: typeof timestamp === "number" ? timestamp : 0
    }
  });

  return state;
};

module.exports = {
  getStudentState,
  updateStudentState
};
