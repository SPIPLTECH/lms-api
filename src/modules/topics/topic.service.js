const ApiError = require("../../utils/ApiError");
const prisma = require("../../config/database");
const { claimContainerOrder, releaseContainerOrder, moveContainers } = require("../contents/contentOrder.util");

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
  const requestedOrder =
    data.order === undefined || data.order === null || isNaN(Number(data.order)) ? null : Number(data.order);

  // A topic added to an already-published course goes live with it.
  const parentLesson = await prisma.lesson.findUnique({
    where: { id: data.lessonId },
    select: { module: { select: { course: { select: { status: true } } } } }
  });

  // Takes its position in the lesson's ONE common sequence (shared with the
  // lesson's Content, Quizzes and Assignments): appended, or inserted at the
  // requested order with every later item moved down one.
  return prisma.$transaction(async (tx) => {
    const order = await claimContainerOrder("topic", data.lessonId, requestedOrder, tx);
    return tx.topic.create({
      data: {
        ...data,
        order,
        isPublished: data.isPublished ?? parentLesson?.module?.course?.status === "PUBLISHED"
      },
    });
  });
};

const updateTopic = async (topicId, data) => {
  const existing = await prisma.topic.findUnique({ where: { id: topicId } });
  if (!existing) {
    const error = new Error("Topic not found");
    error.statusCode = 404;
    throw error;
  }

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
  const existing = await prisma.topic.findUnique({
    where: { id: topicId },
    include: { subTopics: { select: { id: true, concepts: { select: { id: true } } } } },
  });
  if (!existing) {
    const error = new Error("Topic not found");
    error.statusCode = 404;
    throw error;
  }

  const subTopicIds = (existing.subTopics || []).map((s) => s.id);
  const conceptIds = (existing.subTopics || []).flatMap((s) =>
    (s.concepts || []).map((c) => c.id)
  );

  return await prisma.$transaction(async (tx) => {
    // 1. Delete every quiz at or below this topic. SubTopic/Concept rows and
    //    their Content are removed by the database's ON DELETE CASCADE when
    //    the topic goes, but Quiz does NOT cascade to QuizQuestion or
    //    QuizSubmission -- so descendant quizzes have to be cleared here or
    //    they would be orphaned exactly as topic-level ones once were.
    const quizzesToDelete = await tx.quiz.findMany({
      where: {
        OR: [
          { topicId },
          ...(subTopicIds.length > 0 ? [{ subTopicId: { in: subTopicIds } }] : []),
          ...(conceptIds.length > 0 ? [{ conceptId: { in: conceptIds } }] : []),
        ],
      },
      select: { id: true }
    });

    const quizIds = quizzesToDelete.map((q) => q.id);

    if (quizIds.length > 0) {
      await tx.quizQuestion.deleteMany({ where: { quizId: { in: quizIds } } });
      await tx.quizSubmission.deleteMany({ where: { quizId: { in: quizIds } } });
      await tx.quiz.deleteMany({ where: { id: { in: quizIds } } });
    }

    // 2. Delete contents at every level under this topic
    if (conceptIds.length > 0) {
      await tx.content.deleteMany({ where: { conceptId: { in: conceptIds } } });
      await tx.concept.deleteMany({ where: { id: { in: conceptIds } } });
    }
    if (subTopicIds.length > 0) {
      await tx.content.deleteMany({ where: { subTopicId: { in: subTopicIds } } });
      await tx.subTopic.deleteMany({ where: { id: { in: subTopicIds } } });
    }
    await tx.content.deleteMany({ where: { topicId } });

    // 3. Delete topic
    const deleted = await tx.topic.delete({
      where: {
        id: topicId,
      },
    });

    // 4. Close the topic's slot in its lesson's common sequence
    await releaseContainerOrder("topic", existing.lessonId, existing.order, tx);
    return deleted;
  });
};

/**
 * Moves topics within their lesson's learning sequence, which they share
 * with the lesson's Content rows: each listed topic goes to its requested
 * position, everything else keeps its relative order, and the sequence stays
 * 1..n. A topic of another lesson is refused.
 */
const reorderTopics = async (lessonId, topics) => {
  const existing = await prisma.topic.findMany({
    where: { lessonId },
    select: { id: true }
  });
  const validIds = new Set(existing.map((row) => row.id));
  if (!topics.every((row) => validIds.has(row.id))) {
    throw new ApiError(403, "One or more topics do not belong to this lesson.");
  }

  return prisma.$transaction((tx) =>
    moveContainers("topic", lessonId, topics.map(({ id, order }) => ({ id, order })), tx)
  );
};

module.exports = {
  getTopics,
  getTopicById,
  createTopic,
  updateTopic,
  deleteTopic,
  reorderTopics,
};
