const prisma = require("../config/database");
const { buildOwnershipCheck } = require("./ownership.middleware");

const findContentById = (id) =>
  prisma.content.findUnique({
    where: { id },
    include: {
      lesson: {
        include: {
          module: { include: { course: { select: { creatorId: true } } } },
        },
      },
    },
  });

const getCourseCreatorId = (content) =>
  content.lesson?.module?.course?.creatorId;

/**
 * Verifies the caller owns the course behind req.params.contentId.
 * ADMIN always passes.
 *
 * Fixes a prior bug where the check was written as
 * `req.user.role !== ("INSTRUCTOR" || "ADMIN")`, which JavaScript evaluates
 * to the constant `role !== "INSTRUCTOR"` — letting any instructor bypass
 * ownership and incorrectly blocking ADMIN unless they were the creator.
 * This middleware previously existed but was never wired into the content
 * routes; it is now applied to the mutating routes in content.routes.js.
 */
const verifyContentOwnership = buildOwnershipCheck({
  getResourceId: (req) => req.params.contentId,
  findResource: findContentById,
  getCourseCreatorId,
  notFoundMessage: "Content not found",
  missingIdMessage: "contentId is required",
  attachAs: "content",
});

module.exports = verifyContentOwnership;
module.exports.verifyContentOwnership = verifyContentOwnership;
