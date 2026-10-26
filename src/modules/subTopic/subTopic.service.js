const ApiError = require("../../utils/ApiError");
const prisma = require("../../config/database");
const { claimContainerOrder, releaseContainerOrder } = require("../contents/contentOrder.util");

const getSubTopics = async (topicId, role, userId) => {
  const where = {};

  if (topicId) {
    where.topicId = topicId;
  } else if (role === "INSTRUCTOR") {
    where.topic = { lesson: { module: { course: { creatorId: userId } } } };
  }

  if (role === "STUDENT" || role === "GUEST") {
    where.isPublished = true;
  }

  return prisma.subTopic.findMany({
    where,
    orderBy: {
      order: "asc",
    },
    include: {
      // Merged into the SubTopic's own sequence by the Course Map, like its
      // content and quizzes; the rows themselves are ordered here.
      assignments: {
        where: role === "STUDENT" || role === "GUEST" ? { isPublished: true } : undefined,
        orderBy: { order: "asc" },
      },
    },
  });
};

const getSubTopicById = async (subTopicId) => {
  return prisma.subTopic.findUnique({
    where: {
      id: subTopicId,
    },
    include: {
      contents: {
        orderBy: {
          order: "asc",
        },
      },
      concepts: {
        orderBy: {
          order: "asc",
        },
        include: {
          contents: {
            orderBy: {
              order: "asc",
            },
          },
        },
      },
    },
  });
};

const createSubTopic = async (data) => {
  const requestedOrder =
    data.order === undefined || data.order === null || isNaN(Number(data.order)) ? null : Number(data.order);

  // Takes its position in the topic's ONE common sequence (shared with the
  // topic's Content, Quizzes and Assignments): appended, or inserted at the
  // requested order with every later item moved down one.
  return prisma.$transaction(async (tx) => {
    const order = await claimContainerOrder("subTopic", data.topicId, requestedOrder, tx);
    return tx.subTopic.create({
      data: {
        ...data,
        order,
        // Published on creation: a draft is invisible to students along with
        // everything inside it. The course's own status still gates access.
        isPublished: data.isPublished ?? true,
      },
    });
  });
};

const updateSubTopic = async (subTopicId, data) => {
  const existing = await prisma.subTopic.findUnique({ where: { id: subTopicId } });
  if (!existing) {
    const error = new Error("SubTopic not found");
    error.statusCode = 404;
    throw error;
  }

  if (data.order !== undefined && data.order !== null) {
    data.order = Number(data.order);
  }

  return prisma.subTopic.update({
    where: {
      id: subTopicId,
    },
    data,
  });
};

const deleteSubTopic = async (subTopicId) => {
  const existing = await prisma.subTopic.findUnique({
    where: { id: subTopicId },
    include: { concepts: { select: { id: true } } },
  });
  if (!existing) {
    const error = new Error("SubTopic not found");
    error.statusCode = 404;
    throw error;
  }

  const conceptIds = (existing.concepts || []).map((c) => c.id);

  return await prisma.$transaction(async (tx) => {
    // 1. Delete all subtopic-level AND concept-level quizzes. QuizSubmission
    //    and QuizQuestion have no cascade from Quiz, so they are cleared
    //    explicitly -- same order topic.service.deleteTopic uses.
    const quizzesToDelete = await tx.quiz.findMany({
      where: {
        OR: [
          { subTopicId },
          ...(conceptIds.length > 0 ? [{ conceptId: { in: conceptIds } }] : []),
        ],
      },
      select: { id: true },
    });

    const quizIds = quizzesToDelete.map((q) => q.id);

    if (quizIds.length > 0) {
      await tx.quizQuestion.deleteMany({ where: { quizId: { in: quizIds } } });
      await tx.quizSubmission.deleteMany({ where: { quizId: { in: quizIds } } });
      await tx.quiz.deleteMany({ where: { id: { in: quizIds } } });
    }

    // 2. Delete concept contents and concepts, then subtopic-direct contents
    if (conceptIds.length > 0) {
      await tx.content.deleteMany({ where: { conceptId: { in: conceptIds } } });
      await tx.concept.deleteMany({ where: { id: { in: conceptIds } } });
    }
    await tx.content.deleteMany({ where: { subTopicId } });

    // 3. Delete subtopic
    const deleted = await tx.subTopic.delete({
      where: {
        id: subTopicId,
      },
    });

    // 4. Close the subtopic's slot in its topic's common sequence
    await releaseContainerOrder("subTopic", existing.topicId, existing.order, tx);
    return deleted;
  });
};

module.exports = {
  getSubTopics,
  getSubTopicById,
  createSubTopic,
  updateSubTopic,
  deleteSubTopic,
};
