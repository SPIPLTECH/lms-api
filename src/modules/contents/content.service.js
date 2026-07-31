const prisma =
  require("../../config/database");

const getContents = async (
  lessonId,
  role,
  userId
) => {
  const where = {};

  if (lessonId) {
    where.lessonId = lessonId;
  } else if (role === "INSTRUCTOR") {
    // No specific lesson requested: scope to this instructor's own courses only.
    where.lesson = { module: { course: { creatorId: userId } } };
  }

  return prisma.content.findMany({
    where,
    orderBy: {
      order: "asc"
    }
  });
};

const getContentById = async (
  contentId
) => {
  return prisma.content.findUnique({
    where: {
      id: contentId
    }
  });
};

const { sanitizeContent } = require("../../utils/sanitizer");

const createContent = async (
  data
) => {
  if (data.htmlContent) {
    data.htmlContent = sanitizeContent(data.htmlContent);
  }
  return prisma.content.create({
    data
  });
};

const updateContent = async (
  contentId,
  data
) => {
  if (data.htmlContent) {
    data.htmlContent = sanitizeContent(data.htmlContent);
  }
  return prisma.content.update({
    where: {
      id: contentId
    },
    data
  });
};

const deleteContent = async (
  contentId
) => {
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