const prisma = require("../config/database");
const { buildOwnershipCheck } = require("./ownership.middleware");

const findQuizById = (id) =>
  prisma.quiz.findUnique({
    where: { id },
    include: { course: { select: { creatorId: true } } },
  });

const getCourseCreatorId = (quiz) => quiz.course?.creatorId;

/**
 * Verifies the caller owns the course behind req.params.quizId. ADMIN always
 * passes. Applies to quiz mutation routes and the nested
 * question-management routes under /quizzes/:quizId/questions, all of which
 * carry quizId as a URL param.
 */
const verifyQuizOwnership = buildOwnershipCheck({
  getResourceId: (req) => req.params.quizId,
  findResource: findQuizById,
  getCourseCreatorId,
  notFoundMessage: "Quiz not found",
  missingIdMessage: "quizId is required",
  attachAs: "quiz",
});

module.exports = verifyQuizOwnership;
module.exports.verifyQuizOwnership = verifyQuizOwnership;
