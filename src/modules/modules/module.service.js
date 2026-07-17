const prisma = require("../../config/database");

const getModules = async (courseId, role) => {
  const where = { courseId };
  if (role === "STUDENT" || role === "GUEST") {
    where.isPublished = true;
  }
  return await prisma.module.findMany({
    where,
    orderBy: {
      order: "asc"
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
  return await prisma.module.create({
    data
  });
};

const updateModule = async (
  moduleId,
  data
) => {
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
  const updates = modules.map(
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
    updates
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