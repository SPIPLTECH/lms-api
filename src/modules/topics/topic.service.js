const prisma = require("../../config/database");

const getTopics = async (lessonId, role, userId) => {
  const where = {};

  if (lessonId) {
    where.lessonId = lessonId;
  } else if (role === "INSTRUCTOR") {
    where.lesson = { module: { course: { creatorId: userId } } };
  }

  if (role === "STUDENT" || role === "GUEST") {
    where.isPublished = true;
  }

  return prisma.topic.findMany({
    where,
    orderBy: {
      order: "asc",
    },
  });
};

const getTopicById = async (topicId) => {
  return prisma.topic.findUnique({
    where: {
      id: topicId,
    },
    include: {
      contents: {
        orderBy: {
          order: "asc",
        },
      },
    },
  });
};

const createTopic = async (data) => {
  if (data.order === undefined || data.order === null || isNaN(Number(data.order))) {
    const maxTopic = await prisma.topic.findFirst({
      where: { lessonId: data.lessonId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    data.order = maxTopic ? maxTopic.order + 1 : 1;
  } else {
    data.order = Number(data.order);
  }

  return prisma.topic.create({
    data,
  });
};

const updateTopic = async (topicId, data) => {
  if (data.order !== undefined && data.order !== null) {
    data.order = Number(data.order);
  }

  return prisma.topic.update({
    where: {
      id: topicId,
    },
    data,
  });
};

const deleteTopic = async (topicId) => {
  return prisma.topic.delete({
    where: {
      id: topicId,
    },
  });
};

const reorderTopics = async (lessonId, topics) => {
  // Two-phase reorder: @@unique([lessonId, order]) rejects a naive
  // parallel swap (A->2 while B still holds 2), so first move every
  // row to a disjoint negative placeholder, then to its final order.
  const offsetUpdates = topics.map((topic, index) =>
    prisma.topic.update({
      where: {
        id: topic.id,
      },
      data: {
        order: -1000 - index,
      },
    })
  );

  const finalUpdates = topics.map((topic) =>
    prisma.topic.update({
      where: {
        id: topic.id,
      },
      data: {
        order: topic.order,
      },
    })
  );

  return prisma.$transaction([...offsetUpdates, ...finalUpdates]);
};

module.exports = {
  getTopics,
  getTopicById,
  createTopic,
  updateTopic,
  deleteTopic,
  reorderTopics,
};
