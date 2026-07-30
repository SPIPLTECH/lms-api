const prisma = require("../config/database");
const { buildOwnershipCheck } = require("./ownership.middleware");

const findModuleById = (id) =>
  prisma.module.findUnique({
    where: { id },
    include: { course: { select: { creatorId: true } } },
  });

const getCourseCreatorId = (module) => module.course?.creatorId;

/**
 * Verifies the caller owns the course behind req.params.moduleId.
 * ADMIN always passes.
 *
 * Fixes a prior bug where the check was written as
 * `req.user.role !== ("INSTRUCTOR" || "ADMIN")`, which JavaScript evaluates
 * to the constant `role !== "INSTRUCTOR"` — letting any instructor bypass
 * ownership and incorrectly blocking ADMIN unless they were the creator.
 */
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
