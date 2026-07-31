const prisma = require("../../config/database");

const createAnnouncement = async ({ courseId, instructorId, title, message }) => {
  return prisma.announcement.create({
    data: { courseId, instructorId, title, message }
  });
};

const getAnnouncements = async (user) => {
  const where = user.role === "ADMIN" ? {} : { instructorId: user.id };

  return prisma.announcement.findMany({
    where,
    include: {
      course: {
        select: { id: true, title: true }
      }
    },
    orderBy: { createdAt: "desc" },
    take: 20
  });
};

module.exports = {
  createAnnouncement,
  getAnnouncements
};
