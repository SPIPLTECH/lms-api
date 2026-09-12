const prisma = require("../../config/database");

const getBookmarks = async (studentId, query = {}) => {
  const where = { studentId };

  if (query.type) {
    where.type = query.type;
  }

  return prisma.bookmark.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
};

const createBookmark = async (data, studentId) => {
  return prisma.bookmark.create({
    data: {
      type: data.type,
      title: data.title,
      detail: data.detail,
      url: data.url,
      courseId: data.courseId,
      lessonId: data.lessonId,
      studentId,
    },
  });
};

const deleteBookmark = async (bookmarkId, studentId) => {
  const bookmark = await prisma.bookmark.findFirst({
    where: { id: bookmarkId, studentId },
  });

  if (!bookmark) {
    const error = new Error("Bookmark not found or access denied");
    error.statusCode = 404;
    throw error;
  }

  return prisma.bookmark.delete({ where: { id: bookmarkId } });
};

module.exports = { getBookmarks, createBookmark, deleteBookmark };
