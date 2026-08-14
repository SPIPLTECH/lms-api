const prisma = require("../config/database");
const { buildOwnershipCheck } = require("./ownership.middleware");

const findLessonById = (id) =>
  prisma.lesson.findUnique({
    where: { id },
    include: {
      module: { include: { course: { select: { creatorId: true } } } },
    },
  });

const getCourseCreatorId = (lesson) => lesson.module?.course?.creatorId;

      if (
        req.user.role !==
          "ADMIN" &&
        lesson.module.course
          .creatorId !==
          req.user.id
      ) {
        return res.status(403).json({
          message:
            "Access denied"
        });
      }

/**
 * Same ownership check, keyed on req.body.lessonId instead of a URL param.
 * Used when creating a child resource (content) under a lesson.
 */
const verifyLessonOwnershipFromBody = buildOwnershipCheck({
  getResourceId: (req) => req.body.lessonId,
  findResource: findLessonById,
  getCourseCreatorId,
  notFoundMessage: "Lesson not found",
  missingIdMessage: "lessonId is required",
  attachAs: "lesson",
});

/**
 * Same ownership check, keyed on req.query.lessonId. Used by list endpoints
 * for a lesson's child resources (e.g. GET /lesson-notes?lessonId=...) where
 * the lesson id arrives as a query param rather than a URL param or body.
 */
const verifyLessonOwnershipFromQuery = buildOwnershipCheck({
  getResourceId: (req) => req.query.lessonId,
  findResource: findLessonById,
  getCourseCreatorId,
  notFoundMessage: "Lesson not found",
  missingIdMessage: "lessonId is required",
  attachAs: "lesson",
});

module.exports = verifyLessonOwnership;
module.exports.verifyLessonOwnership = verifyLessonOwnership;
module.exports.fromBody = verifyLessonOwnershipFromBody;
module.exports.fromQuery = verifyLessonOwnershipFromQuery;
