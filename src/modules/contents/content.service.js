const prisma =
  require("../../config/database");

const getContents = async (
  lessonId
) => {
  return prisma.content.findMany({
    where: {
      lessonId
    },
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

const createContent = async (
  data
) => {
  return prisma.content.create({
    data
  });
};

const updateContent = async (
  contentId,
  data
) => {
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