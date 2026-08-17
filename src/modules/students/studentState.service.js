const prisma = require("../../config/database");

const getStudentState = async (userId) => {
  const studentProfile = await prisma.studentProfile.findUnique({
    where: { userId }
  });

  if (!studentProfile) {
    const error = new Error("Student profile not found");
    error.statusCode = 404;
    throw error;
  }

  // StudentState is unique per (studentId, courseId) — a student has one row
  // per course, not one globally — so this can't be a findUnique on studentId
  // alone. The caller doesn't scope by course, so return whichever course's
  // state was touched most recently.
  const state = await prisma.studentState.findFirst({
    where: { studentId: studentProfile.id },
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
