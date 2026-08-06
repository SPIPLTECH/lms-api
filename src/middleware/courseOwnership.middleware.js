const prisma = require("../config/database");
const ApiError = require("../utils/ApiError");
const { buildOwnershipCheck } = require("./ownership.middleware");

const findCourse = (id) =>
  prisma.course.findUnique({
    where: { id },
    select: { id: true, creatorId: true },
  });

const getCourseCreatorId = (course) => course.creatorId;

/**
 * Verifies the caller owns the course identified by req.params.courseId.
 * ADMIN always passes. Used on routes that operate directly on a course.
 */
const verifyCourseOwnership = buildOwnershipCheck({
  getResourceId: (req) => req.params.courseId,
  findResource: findCourse,
  getCourseCreatorId,
  notFoundMessage: "Course not found",
  missingIdMessage: "courseId is required",
  attachAs: "course",
});

/**
 * Same check, but reads the course id from req.body.courseId instead of the
 * URL params. Used on "create a child of this course" routes (modules,
 * quizzes, assignments, live classes, certificates) where the course hasn't
 * been reached via a resource id yet.
 */
const verifyCourseOwnershipFromBody = buildOwnershipCheck({
  getResourceId: (req) => req.body.courseId,
  findResource: findCourse,
  getCourseCreatorId,
  notFoundMessage: "Course not found",
  missingIdMessage: "courseId is required",
  attachAs: "course",
});

/**
 * Same check, but reads the course id from req.query.courseId. Used on list
 * endpoints for a course's child resources (e.g. GET /discussions?courseId=...).
 */
const verifyCourseOwnershipFromQuery = buildOwnershipCheck({
  getResourceId: (req) => req.query.courseId,
  findResource: findCourse,
  getCourseCreatorId,
  notFoundMessage: "Course not found",
  missingIdMessage: "courseId is required",
  attachAs: "course",
});

module.exports = verifyCourseOwnership;
module.exports.verifyCourseOwnership = verifyCourseOwnership;
module.exports.fromBody = verifyCourseOwnershipFromBody;
module.exports.fromQuery = verifyCourseOwnershipFromQuery;
