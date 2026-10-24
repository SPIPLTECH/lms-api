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

module.exports = {
  getTeachers,
};

