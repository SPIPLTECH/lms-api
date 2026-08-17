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
  return await prisma.module.delete({
    where: {
      id: moduleId
    }
  });
};

const reorderModules = async (
  courseId,
  modules
) => {
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

  return await prisma.$transaction(
    [...offsetUpdates, ...finalUpdates]
  );
};

module.exports = {
  getModules,
  getModuleById,
  createModule,
  updateModule,
  deleteModule,
  reorderModules
};