const prisma = require("../../config/database");

const createAnnouncement = async ({ courseId, instructorId, title, message }) => {
  return prisma.announcement.create({
    data: { courseId, instructorId, title, message }
  });
};

module.exports = {
  createAnnouncement
};
