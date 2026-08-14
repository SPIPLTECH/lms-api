const prisma = require("../config/database");
const { buildOwnershipCheck } = require("./ownership.middleware");

const findModuleById = (id) =>
  prisma.module.findUnique({
    where: { id },
    include: { course: { select: { creatorId: true } } },
  });

const getCourseCreatorId = (module) => module.course?.creatorId;

    if (
      req.user.role !== "ADMIN" &&
      module.course.creatorId !==
        req.user.id
    ) {
      return res.status(403).json({
        message: "Access denied"
      });
    }

/**
 * Same ownership check, keyed on req.body.moduleId instead of a URL param.
 * Used when creating a child resource (a lesson) under a module — we need to
 * confirm the caller owns the module's course before the lesson exists.
 */
const verifyModuleOwnershipFromBody = buildOwnershipCheck({
  getResourceId: (req) => req.body.moduleId,
  findResource: findModuleById,
  getCourseCreatorId,
  notFoundMessage: "Module not found",
  missingIdMessage: "moduleId is required",
  attachAs: "module",
});

module.exports = verifyModuleOwnership;
module.exports.verifyModuleOwnership = verifyModuleOwnership;
module.exports.fromBody = verifyModuleOwnershipFromBody;
