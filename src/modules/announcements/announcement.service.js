const prisma = require("../../config/database");

const createAnnouncement = async ({ courseId, instructorId, title, message, batchId = null }) => {
  return prisma.announcement.create({
    data: { courseId, instructorId, title, message, batchId }
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

const getBatchAnnouncements = async (batchId) => {
  return prisma.announcement.findMany({
    where: { batchId },
    include: { instructor: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 20
  });
};

module.exports = {
  createAnnouncement,
  getAnnouncements,
  getBatchAnnouncements
};
