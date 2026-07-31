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
  // The caller's ownership of `courseId` is verified by middleware before
  // this runs, but that only proves they own the course — not that every id
  // in the reorder payload actually belongs to it. Without this check, an
  // instructor could smuggle a module id from a course they don't own into
  // the array and silently reorder someone else's module.
  const owned = await prisma.module.findMany({
    where: {
      id: { in: modules.map((module) => module.id) },
      courseId
    },
    select: { id: true }
  });

  const ownedIds = new Set(owned.map((module) => module.id));
  const invalidId = modules.find((module) => !ownedIds.has(module.id));

  if (invalidId) {
    throw new ApiError(
      403,
      "Forbidden: one or more modules do not belong to this course"
    );
  }

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