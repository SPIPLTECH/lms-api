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

const findBatch = (id) =>
  prisma.batch.findUnique({
    where: { id },
    select: { id: true, courseId: true, course: { select: { creatorId: true } } },
  });

/**
 * Verifies the caller owns the course behind the batch identified by
 * req.params.batchId. ADMIN always passes. Used on batch-detail and
 * batch-membership routes (add/remove student, etc).
 */
const verifyBatchOwnership = buildOwnershipCheck({
  getResourceId: (req) => req.params.batchId,
  findResource: findBatch,
  getCourseCreatorId: (batch) => batch.course?.creatorId,
  notFoundMessage: "Batch not found",
  missingIdMessage: "batchId is required",
  attachAs: "batch",
});

/**
 * Verifies the caller may VIEW (read-only) the batch identified by
 * req.params.batchId — either as the owning instructor/admin (same rule as
 * verifyBatchOwnership) or as a STUDENT who is a member of the batch.
 * Used only on the read-only batch routes students can reach (batch detail,
 * dashboard, announcements); every batch management route (create,
 * add/remove student, update status, post announcement) keeps
 * verifyBatchOwnership unchanged, so instructor-only write access is
 * untouched.
 */
const verifyBatchAccess = async (req, res, next) => {
  try {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required"));
    }

    const batchId = req.params.batchId;
    if (!batchId) {
      return next(new ApiError(400, "batchId is required"));
    }

    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      select: {
        id: true,
        courseId: true,
        course: { select: { creatorId: true } },
        students: { select: { userId: true } },
      },
    });

    if (!batch) {
      return next(new ApiError(404, "Batch not found"));
    }

    req.batch = batch;

    if (req.user.role === "ADMIN") {
      return next();
    }

    if (req.user.role === "INSTRUCTOR") {
      if (batch.course?.creatorId === req.user.id) {
        return next();
      }
      return next(new ApiError(403, "Forbidden: you do not own this resource"));
    }

    if (req.user.role === "STUDENT") {
      const isMember = batch.students.some((s) => s.userId === req.user.id);
      if (isMember) {
        return next();
      }
      return next(new ApiError(403, "Forbidden: you are not a member of this batch"));
    }

    return next(new ApiError(403, "Forbidden: insufficient role"));
  } catch (error) {
    next(error);
  }
};

module.exports = verifyCourseOwnership;
module.exports.verifyCourseOwnership = verifyCourseOwnership;
module.exports.fromBody = verifyCourseOwnershipFromBody;
module.exports.fromQuery = verifyCourseOwnershipFromQuery;
module.exports.verifyBatchOwnership = verifyBatchOwnership;
module.exports.verifyBatchAccess = verifyBatchAccess;
