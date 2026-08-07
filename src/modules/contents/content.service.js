const prisma = require("../../config/database");
const { sanitizeContent } = require("../../utils/sanitizer");

const getContents = async (lessonId, role, userId) => {
  const where = {};

  if (lessonId) {
    where.lessonId = lessonId;
  } else if (role === "INSTRUCTOR") {
    where.lesson = { module: { course: { creatorId: userId } } };
  }

  return prisma.content.findMany({
    where,
    orderBy: {
      order: "asc"
    }
  });
};

const getContentById = async (contentId) => {
  return prisma.content.findUnique({
    where: {
      id: contentId
    }
  });
};

const createContent = async (data) => {
  if (data.htmlContent) {
    data.htmlContent = sanitizeContent(data.htmlContent);
  }

  // Auto-calculate order if missing or not an integer
  if (data.order === undefined || data.order === null || isNaN(Number(data.order))) {
    const maxContent = await prisma.content.findFirst({
      where: { lessonId: data.lessonId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    data.order = maxContent ? maxContent.order + 1 : 1;
  } else {
    data.order = Number(data.order);
  }

  return prisma.content.create({
    data
  });
};

const updateContent = async (contentId, data) => {
  if (data.htmlContent) {
    data.htmlContent = sanitizeContent(data.htmlContent);
  }
  if (data.order !== undefined && data.order !== null) {
    data.order = Number(data.order);
  }
  return prisma.content.update({
    where: {
      id: contentId
    },
    data
  });
};

const deleteContent = async (contentId) => {
  return prisma.content.delete({
    where: {
      id: contentId
    }
  });
};

module.exports = {
  getContents,
  getContentById,
  createContent,
  updateContent,
  deleteContent
};