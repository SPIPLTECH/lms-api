const prisma = require("../../config/database");

const getLearningPathByStudentId = async (studentId) => {
  if (!studentId) return null;

  let path = await prisma.learningPath.findUnique({
    where: { studentId },
  });

  if (!path) {
    const profile = await prisma.studentProfile.findFirst({
      where: { OR: [{ id: studentId }, { userId: studentId }] },
      select: { id: true },
    });

    if (profile) {
      path = await prisma.learningPath.findUnique({
        where: { studentId: profile.id },
      });
    }
  }

  return path || null;
};

module.exports = {
  getLearningPathByStudentId,
};
