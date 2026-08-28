const prisma = require("../../config/database");
const { sanitizeContent } = require("../../utils/sanitizer");

const getContents = async (topicId, role, userId) => {
  const where = {};

  if (topicId) {
    where.topicId = topicId;
  } else if (role === "INSTRUCTOR") {
    where.topic = { lesson: { module: { course: { creatorId: userId } } } };
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
  const { lessonId, parentContentId, ...contentData } = data;

  if (contentData.htmlContent) {
    contentData.htmlContent = sanitizeContent(contentData.htmlContent);
  }

  // Auto-calculate order if missing or not an integer
  if (contentData.order === undefined || contentData.order === null || isNaN(Number(contentData.order))) {
    const maxContent = await prisma.content.findFirst({
      where: { topicId: contentData.topicId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    contentData.order = maxContent ? maxContent.order + 1 : 1;
  } else {
    contentData.order = Number(contentData.order);
  }

  return prisma.content.create({
    data: contentData
  });
};

const updateContent = async (contentId, data) => {
  const existing = await prisma.content.findUnique({ where: { id: contentId } });
  if (!existing) {
    const error = new Error("Content not found");
    error.statusCode = 404;
    throw error;
  }

  const { lessonId, parentContentId, ...contentData } = data;

  if (contentData.htmlContent) {
    contentData.htmlContent = sanitizeContent(contentData.htmlContent);
  }
  if (contentData.order !== undefined && contentData.order !== null) {
    contentData.order = Number(contentData.order);
  }
  return prisma.content.update({
    where: {
      id: contentId
    },
    data: contentData
  });
};

const deleteContent = async (contentId) => {
  const existing = await prisma.content.findUnique({ where: { id: contentId } });
  if (!existing) {
    const error = new Error("Content not found");
    error.statusCode = 404;
    throw error;
  }

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