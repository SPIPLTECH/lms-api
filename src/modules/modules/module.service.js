const prisma = require("../../config/database");

const getModules = async (courseId) => {
  return await prisma.module.findMany({
    where: {
      courseId
    },
    orderBy: {
      order: "asc"
    }
  });
};

const getModuleById = async (moduleId) => {
  return await prisma.module.findUnique({
    where: {
      id: moduleId
    },
    include: {
  lessons: {
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
          id: module.moduleId
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