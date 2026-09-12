const prisma = require("../config/database");
const { buildOwnershipCheck } = require("./ownership.middleware");

const findModuleById = (id) =>
  prisma.module.findUnique({
    where: { id },
    include: { course: { select: { creatorId: true } } },
  });

const getCourseCreatorId = (module) => module.course?.creatorId;

const verifyModuleOwnership = buildOwnershipCheck({
  getResourceId: (req) => req.params.moduleId,
  findResource: findModuleById,
  getCourseCreatorId,
  notFoundMessage: "Module not found",
  missingIdMessage: "moduleId is required",
  attachAs: "module",
});

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
