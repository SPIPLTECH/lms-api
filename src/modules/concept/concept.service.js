const ApiError = require("../../utils/ApiError");
const prisma = require("../../config/database");
const { claimContainerOrder, releaseContainerOrder, moveContainers } = require("../contents/contentOrder.util");

const getConcepts = async (subTopicId, role, userId) => {
  const where = {};

  if (subTopicId) {
    where.subTopicId = subTopicId;
  } else if (role === "INSTRUCTOR") {
    where.subTopic = {
      topic: { lesson: { module: { course: { creatorId: userId } } } },
    };
  }

  if (role === "STUDENT" || role === "GUEST") {
    where.isPublished = true;
  }

  return prisma.concept.findMany({
    where,
    orderBy: {
      order: "asc",
    },
    include: {
      // Same as SubTopics one level up: the Concept's own assignments travel
      // with the row so the Course Map can place them by `order`.
      assignments: {
        where: role === "STUDENT" || role === "GUEST" ? { isPublished: true } : undefined,
        orderBy: { order: "asc" },
      },
    },
  });
};

const getConceptById = async (conceptId) => {
  return prisma.concept.findUnique({
    where: {
      id: conceptId,
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

const createConcept = async (data) => {
  const requestedOrder =
    data.order === undefined || data.order === null || isNaN(Number(data.order)) ? null : Number(data.order);

  // A concept added to an already-published course goes live with it --
  // same rule topic.service/subTopic.service apply at their levels.
  const parentSubTopic = await prisma.subTopic.findUnique({
    where: { id: data.subTopicId },
    select: {
      topic: {
        select: {
          lesson: { select: { module: { select: { course: { select: { status: true } } } } } },
        },
      },
    },
  });

  // Takes its position in the subtopic's ONE common sequence (shared with the
  // subtopic's Content, Quizzes and Assignments): appended, or inserted at the
  // requested order with every later item moved down one.
  return prisma.$transaction(async (tx) => {
    const order = await claimContainerOrder("concept", data.subTopicId, requestedOrder, tx);
    return tx.concept.create({
      data: {
        ...data,
        order,
        isPublished:
          data.isPublished ??
          parentSubTopic?.topic?.lesson?.module?.course?.status === "PUBLISHED",
      },
    });
  });
};

const updateConcept = async (conceptId, data) => {
  const existing = await prisma.concept.findUnique({ where: { id: conceptId } });
  if (!existing) {
    const error = new Error("Concept not found");
    error.statusCode = 404;
    throw error;
  }

  if (data.order !== undefined && data.order !== null) {
    data.order = Number(data.order);
  }

  return prisma.concept.update({
    where: {
      id: conceptId,
    },
    data,
  });
};

const deleteConcept = async (conceptId) => {
  const existing = await prisma.concept.findUnique({ where: { id: conceptId } });
  if (!existing) {
    const error = new Error("Concept not found");
    error.statusCode = 404;
    throw error;
  }

  return await prisma.$transaction(async (tx) => {
    // 1. Delete all concept-level quizzes. QuizSubmission and QuizQuestion
    //    have no cascade from Quiz, so they are cleared explicitly -- same
    //    order topic.service.deleteTopic uses.
    const quizzesToDelete = await tx.quiz.findMany({
      where: { conceptId },
      select: { id: true },
    });

    const quizIds = quizzesToDelete.map((q) => q.id);

    if (quizIds.length > 0) {
      await tx.quizQuestion.deleteMany({ where: { quizId: { in: quizIds } } });
      await tx.quizSubmission.deleteMany({ where: { quizId: { in: quizIds } } });
      await tx.quiz.deleteMany({ where: { id: { in: quizIds } } });
    }

    // 2. Delete contents
    await tx.content.deleteMany({ where: { conceptId } });

    // 3. Delete concept
    const deleted = await tx.concept.delete({
      where: {
        id: conceptId,
      },
    });

    // 4. Close the concept's slot in its subtopic's common sequence
    await releaseContainerOrder("concept", existing.subTopicId, existing.order, tx);
    return deleted;
  });
};

/**
 * Moves concepts within their subtopic's learning sequence, which they share
 * with the subtopic's Content rows: each listed concept goes to its requested
 * position, everything else keeps its relative order, and the sequence stays
 * 1..n. A concept of another subtopic is refused.
 */
const reorderConcepts = async (subTopicId, concepts) => {
  const existing = await prisma.concept.findMany({
    where: { subTopicId },
    select: { id: true }
  });
  const validIds = new Set(existing.map((row) => row.id));
  if (!concepts.every((row) => validIds.has(row.id))) {
    throw new ApiError(403, "One or more concepts do not belong to this subtopic.");
  }

  return prisma.$transaction((tx) =>
    moveContainers("concept", subTopicId, concepts.map(({ id, order }) => ({ id, order })), tx)
  );
};

module.exports = {
  getConcepts,
  getConceptById,
  createConcept,
  updateConcept,
  deleteConcept,
  reorderConcepts,
};
