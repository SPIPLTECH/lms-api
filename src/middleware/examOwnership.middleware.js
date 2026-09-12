const prisma = require("../config/database");
const { buildOwnershipCheck } = require("./ownership.middleware");

const findExamById = (id) =>
  prisma.exam.findUnique({
    where: { id },
    include: { course: { select: { creatorId: true } } },
  });

const getCourseCreatorId = (exam) => exam.course?.creatorId;

/**
 * Verifies the caller owns the course behind req.params.examId.
 * ADMIN always passes.
 */
const verifyExamOwnership = buildOwnershipCheck({
  getResourceId: (req) => req.params.examId,
  findResource: findExamById,
  getCourseCreatorId,
  notFoundMessage: "Test not found",
  missingIdMessage: "examId is required",
  attachAs: "exam",
});

module.exports = verifyExamOwnership;
module.exports.verifyExamOwnership = verifyExamOwnership;
