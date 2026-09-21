const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const {
  claimSequenceOrder,
  releaseSequenceOrder,
  assertCourseReorderAllowed,
} = require("../contents/contentOrder.util");

const getModules = async (courseId, role, userId) => {
  const where = {};
  if (courseId) {
    where.courseId = courseId;
  } else if (role === "INSTRUCTOR") {
    // No specific course requested: scope to this instructor's own courses only.
    where.course = { creatorId: userId };
  }
  if (role === "STUDENT" || role === "GUEST") {
    where.isPublished = true;
  }
  const isStudentOrGuest = role === "STUDENT" || role === "GUEST";
  return await prisma.module.findMany({
    where,
    orderBy: {
      order: "asc"
    },
    include: {
      course: {
        select: { id: true, title: true }
      },
      // Each level's own assignments travel with the tree, so the Course Map
      // can merge them into that level's sequence by `order` instead of
      // showing nothing (this tree carried no assignments at all, which is why
      // a saved course's assignment rows never appeared in the Composer).
      assignments: {
        where: isStudentOrGuest ? { isPublished: true } : undefined,
        orderBy: { order: "asc" }
      },
      lessons: {
        where: isStudentOrGuest ? { isPublished: true } : undefined,
        orderBy: {
          order: "asc"
        },
        include: {
          assignments: {
            where: isStudentOrGuest ? { isPublished: true } : undefined,
            orderBy: { order: "asc" }
          },
          // Without an orderBy Postgres returns topics in physical row order,
          // which shifts whenever a topic row is rewritten (e.g. a sequence
          // shift), so the lesson's topic cards reshuffled on refetch.
          topics: {
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
            include: {
              assignments: {
                where: isStudentOrGuest ? { isPublished: true } : undefined,
                orderBy: { order: "asc" }
              },
              _count: {
                select: { contents: true }
              }
            }
          }
        }
      }
    }
  });
};

const getModuleById = async (moduleId, role) => {
  const isStudentOrGuest = role === "STUDENT" || role === "GUEST";

  const module = await prisma.module.findUnique({
    where: {
      id: moduleId
    },
    include: {
      lessons: {
        where: isStudentOrGuest ? { isPublished: true } : undefined,
        orderBy: {
          order: "asc"
        },
        include: {
          topics: {
            orderBy: [{ order: "asc" }, { createdAt: "asc" }],
            include: {
              _count: {
                select: { contents: true }
              }
            }
          }
        }
      }
    }
  });

  if (!module) return null;

  if (isStudentOrGuest && !module.isPublished) {
    return null;
  }

  return module;
};

const createModule = async (data) => {
  // A module added to an already-published course goes live with it, so new
  // material never sits invisible to students who are already enrolled.
  const course = await prisma.course.findUnique({
    where: { id: data.courseId },
    select: { status: true }
  });

  // Appended to the course's ONE common sequence — after the course's last
  // Content, Quiz, Assignment or Module.
  return await prisma.$transaction(async (tx) => {
    const order = await claimSequenceOrder("courseId", data.courseId, null, tx, "module");
    return tx.module.create({
      data: {
        ...data,
        order,
        isPublished: data.isPublished ?? course?.status === "PUBLISHED"
      }
    });
  });
};

const updateModule = async (
  moduleId,
  data
) => {
  const existing = await prisma.module.findUnique({ where: { id: moduleId } });
  if (!existing) {
    throw new ApiError(404, "Module not found");
  }

  return await prisma.module.update({
    where: {
      id: moduleId
    },
    data
  });
};

const deleteModule = async (
  moduleId
) => {
  const existing = await prisma.module.findUnique({
    where: { id: moduleId },
    include: {
      lessons: {
        select: {
          id: true,
          topics: {
            select: {
              id: true,
              subTopics: { select: { id: true, concepts: { select: { id: true } } } }
            }
          }
        }
      }
    }
  });

  if (!existing) {
    throw new ApiError(404, "Module not found");
  }

  const lessonIds = (existing.lessons || []).map((l) => l.id);
  const topics = (existing.lessons || []).flatMap((l) => l.topics || []);
  const topicIds = topics.map((t) => t.id);
  const subTopics = topics.flatMap((t) => t.subTopics || []);
  const subTopicIds = subTopics.map((s) => s.id);
  const conceptIds = subTopics.flatMap((s) => (s.concepts || []).map((c) => c.id));

  return await prisma.$transaction(async (tx) => {
    // 1. Delete every quiz at or below this module. Descendant containers and
    //    their Content cascade in the database, but Quiz does not cascade to
    //    QuizQuestion or QuizSubmission, so SubTopic/Concept quizzes have to
    //    be cleared here too or they are left orphaned.
    const quizzesToDelete = await tx.quiz.findMany({
      where: {
        OR: [
          { moduleId },
          ...(lessonIds.length > 0 ? [{ lessonId: { in: lessonIds } }] : []),
          ...(topicIds.length > 0 ? [{ topicId: { in: topicIds } }] : []),
          ...(subTopicIds.length > 0 ? [{ subTopicId: { in: subTopicIds } }] : []),
          ...(conceptIds.length > 0 ? [{ conceptId: { in: conceptIds } }] : [])
        ]
      },
      select: { id: true }
    });

    const quizIds = quizzesToDelete.map((q) => q.id);

    if (quizIds.length > 0) {
      await tx.quizQuestion.deleteMany({ where: { quizId: { in: quizIds } } });
      await tx.quizSubmission.deleteMany({ where: { quizId: { in: quizIds } } });
      await tx.quiz.deleteMany({ where: { id: { in: quizIds } } });
    }

    // 2. Delete contents and containers, deepest first
    if (conceptIds.length > 0) {
      await tx.content.deleteMany({ where: { conceptId: { in: conceptIds } } });
      await tx.concept.deleteMany({ where: { id: { in: conceptIds } } });
    }
    if (subTopicIds.length > 0) {
      await tx.content.deleteMany({ where: { subTopicId: { in: subTopicIds } } });
      await tx.subTopic.deleteMany({ where: { id: { in: subTopicIds } } });
    }
    if (topicIds.length > 0) {
      await tx.content.deleteMany({ where: { topicId: { in: topicIds } } });
      await tx.topic.deleteMany({ where: { id: { in: topicIds } } });
    }

    // 3. Delete lessons
    if (lessonIds.length > 0) {
      await tx.lesson.deleteMany({ where: { id: { in: lessonIds } } });
    }

    // 4. Delete module
    const deleted = await tx.module.delete({
      where: {
        id: moduleId
      }
    });

    // 5. Close the module's slot in its course's common sequence
    await releaseSequenceOrder("courseId", existing.courseId, existing.order, tx);
    return deleted;
  });
};

const reorderModules = async (
  courseId,
  modules
) => {
  // Verify every id actually belongs to this course before touching anything,
  // so a caller who owns courseId can't smuggle in another course's module id.
  const existing = await prisma.module.findMany({
    where: { courseId },
    select: { id: true }
  });
  const validIds = new Set(existing.map((module) => module.id));
  const allBelongToCourse = modules.every((module) => validIds.has(module.id));
  if (!allBelongToCourse) {
    throw new ApiError(403, "One or more modules do not belong to this course.");
  }

  // Course level only: modules stay in the Module group — after the course's
  // own content, ahead of its assignments and quizzes.
  await assertCourseReorderAllowed("module", modules);

  // Two-phase reorder: @@unique([courseId, order]) rejects a naive
  // parallel swap (A->2 while B still holds 2), so first move every
  // row to a disjoint negative placeholder, then to its final order.
  const offsetUpdates = modules.map(
    (module, index) =>
      prisma.module.update({
        where: {
          id: module.id
        },
        data: {
          order: -1000 - index
        }
      })
  );
  await prisma.$transaction(offsetUpdates);

  const finalUpdates = modules.map(
    (module) =>
      prisma.module.update({
        where: {
          id: module.id
        },
        data: {
          order: module.order
        }
      })
  );

  return await prisma.$transaction(finalUpdates);
};

module.exports = {
  getModules,
  getModuleById,
  createModule,
  updateModule,
  deleteModule,
  reorderModules
};