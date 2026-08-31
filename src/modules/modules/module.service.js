const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");

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
      lessons: {
        where: isStudentOrGuest ? { isPublished: true } : undefined,
        orderBy: {
          order: "asc"
        },
        include: {
          topics: {
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
  if (data.isPublished) {
    throw new ApiError(400, "A new module can't be published yet — add at least one lesson first.");
  }

  const lastModule = await prisma.module.findFirst({
    where: { courseId: data.courseId },
    orderBy: { order: "desc" },
    select: { order: true }
  });

  return await prisma.module.create({
    data: { ...data, order: (lastModule?.order ?? 0) + 1 }
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

  if (data.isPublished) {
    const lessonCount = await prisma.lesson.count({ where: { moduleId } });
    if (lessonCount === 0) {
      throw new ApiError(400, "Add at least one lesson before publishing this module.");
    }
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
          topics: { select: { id: true } }
        }
      }
    }
  });

  if (!existing) {
    throw new ApiError(404, "Module not found");
  }

  const lessonIds = (existing.lessons || []).map((l) => l.id);
  const topicIds = (existing.lessons || []).flatMap((l) => (l.topics || []).map((t) => t.id));

  return await prisma.$transaction(async (tx) => {
    // 1. Delete all topic-level, lesson-level, and module-level quizzes under this module
    const quizzesToDelete = await tx.quiz.findMany({
      where: {
        OR: [
          { moduleId },
          ...(lessonIds.length > 0 ? [{ lessonId: { in: lessonIds } }] : []),
          ...(topicIds.length > 0 ? [{ topicId: { in: topicIds } }] : [])
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

    // 2. Delete topic contents
    if (topicIds.length > 0) {
      await tx.content.deleteMany({ where: { topicId: { in: topicIds } } });
      await tx.topic.deleteMany({ where: { id: { in: topicIds } } });
    }

    // 3. Delete lessons
    if (lessonIds.length > 0) {
      await tx.lesson.deleteMany({ where: { id: { in: lessonIds } } });
    }

    // 4. Delete module
    return await tx.module.delete({
      where: {
        id: moduleId
      }
    });
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