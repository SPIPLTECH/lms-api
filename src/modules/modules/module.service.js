const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");

const getModules = async (courseId, role) => {
  const where = { courseId };
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
      lessons: {
        where: isStudentOrGuest ? { isPublished: true } : undefined,
        orderBy: {
          order: "asc"
        },
        include: {
          contents: true
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
          contents: true
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

  return await prisma.module.create({
    data
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