const prisma = require("../config/database");
const { buildOwnershipCheck } = require("./ownership.middleware");

const findAssignmentById = (id) =>
  prisma.assignment.findUnique({
    where: { id },
    include: { course: { select: { creatorId: true } } },
  });

const getCourseCreatorId = (assignment) => assignment.course?.creatorId;

/**
 * Verifies the caller owns the course behind req.params.assignmentId.
 * ADMIN always passes.
 */
const verifyAssignmentOwnership = buildOwnershipCheck({
  getResourceId: (req) => req.params.assignmentId,
  findResource: findAssignmentById,
  getCourseCreatorId,
  notFoundMessage: "Assignment not found",
  missingIdMessage: "assignmentId is required",
  attachAs: "assignment",
});

module.exports = verifyAssignmentOwnership;
module.exports.verifyAssignmentOwnership = verifyAssignmentOwnership;
