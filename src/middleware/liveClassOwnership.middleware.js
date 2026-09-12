const prisma = require("../config/database");
const { buildOwnershipCheck } = require("./ownership.middleware");

const findLiveClassById = (id) =>
  prisma.liveClass.findUnique({
    where: { id },
    include: { course: { select: { creatorId: true } } },
  });

const getCourseCreatorId = (liveClass) => liveClass.course?.creatorId;

/**
 * Verifies the caller owns the course behind req.params.liveClassId.
 * ADMIN always passes.
 */
const verifyLiveClassOwnership = buildOwnershipCheck({
  getResourceId: (req) => req.params.liveClassId,
  findResource: findLiveClassById,
  getCourseCreatorId,
  notFoundMessage: "Live class not found",
  missingIdMessage: "liveClassId is required",
  attachAs: "liveClass",
});

module.exports = verifyLiveClassOwnership;
module.exports.verifyLiveClassOwnership = verifyLiveClassOwnership;
