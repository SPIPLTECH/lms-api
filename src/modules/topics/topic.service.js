const prisma = require("../../config/database");
const { claimSequenceOrder, releaseSequenceOrder } = require("../contents/contentOrder.util");

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
    const order = await claimSequenceOrder("lessonId", data.lessonId, requestedOrder, tx, "topic");
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
    await releaseSequenceOrder("lessonId", existing.lessonId, existing.order, tx);
    return deleted;
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
