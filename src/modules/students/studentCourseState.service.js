const prisma = require("../../config/database");

// Per-course AI personalization baseline. Returns null (not a 404) when the
// student hasn't completed that course's entry assessment yet — this is the
// normal, common case, not an error.
const getCourseState = async (userId, courseId) => {
  const studentProfile = await prisma.studentProfile.findUnique({
    where: { userId }
  });

  if (!studentProfile) return null;

  return prisma.studentCourseState.findUnique({
    where: {
      studentId_courseId: {
        studentId: studentProfile.id,
        courseId
      }
    }
  });
};

module.exports = {
  getCourseState
};
