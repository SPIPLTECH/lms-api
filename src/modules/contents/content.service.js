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