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

const reorderContents = async (
  contents
) => {
  // Two-phase reorder: @@unique([lessonId, order]) rejects a naive
  // parallel swap (A->2 while B still holds 2), so first move every
  // row to a disjoint negative placeholder, then to its final order.
  const offsetUpdates = contents.map((content, index) =>
    prisma.content.update({
      where: {
        id: content.id
      },
      data: {
        order: -1000 - index
      }
    })
  );

  const finalUpdates = contents.map((content) =>
    prisma.content.update({
      where: {
        id: content.id
      },
      data: {
        order: content.order
      }
    })
  );

  return prisma.$transaction(
    [...offsetUpdates, ...finalUpdates]
  );
};

module.exports = {
  getContents,
  getContentById,
  createContent,
  updateContent,
  deleteContent,
  reorderContents
};