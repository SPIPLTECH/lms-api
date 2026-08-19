const prisma = require("../config/database");
const ApiError = require("../utils/ApiError");

const findBatchWithCourseOwners = (id) =>
  prisma.batch.findUnique({
    where: { id },
    include: { courses: { select: { id: true, creatorId: true } } },
  });

/**
 * A batch can span multiple courses (many-to-many), so ownership isn't a
 * single equality check like the other *Ownership middlewares: ADMIN always
 * passes; INSTRUCTOR passes if they created at least one of the batch's
 * linked courses.
 */
const verifyBatchOwnership = async (req, res, next) => {
  try {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required"));
    }

    const batchId = req.params.batchId;

    if (!batchId) {
      return next(new ApiError(400, "batchId is required"));
    }

    const batch = await findBatchWithCourseOwners(batchId);

    if (!batch) {
      return next(new ApiError(404, "Batch not found"));
    }

    req.batch = batch;

    if (req.user.role === "ADMIN") {
      return next();
    }

    if (req.user.role !== "INSTRUCTOR") {
      return next(new ApiError(403, "Forbidden: insufficient role"));
    }

    const owns = batch.courses.some((course) => course.creatorId === req.user.id);

    if (!owns) {
      return next(new ApiError(403, "Forbidden: you do not own this batch"));
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Same check as verifyBatchOwnership, but reads the batch id from
 * req.body.batchId instead of req.params.batchId — for "create a child of
 * this batch" routes (e.g. quizzes) where the batch hasn't been reached via
 * a resource id yet. Mirrors courseOwnership.middleware.js's `.fromBody`.
 */
const verifyBatchOwnershipFromBody = async (req, res, next) => {
  try {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required"));
    }

    const batchId = req.body.batchId;

    if (!batchId) {
      return next(new ApiError(400, "batchId is required"));
    }

    const batch = await findBatchWithCourseOwners(batchId);

    if (!batch) {
      return next(new ApiError(404, "Batch not found"));
    }

    req.batch = batch;

    if (req.user.role === "ADMIN") {
      return next();
    }

    if (req.user.role !== "INSTRUCTOR") {
      return next(new ApiError(403, "Forbidden: insufficient role"));
    }

    const owns = batch.courses.some((course) => course.creatorId === req.user.id);

    if (!owns) {
      return next(new ApiError(403, "Forbidden: you do not own this batch"));
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * For batch creation, where there's no batch yet to fetch: every id in
 * req.body.courseIds must belong to the caller (ADMIN bypasses).
 */
const verifyBatchCourseIdsOwnership = async (req, res, next) => {
  try {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required"));
    }

    const { courseIds } = req.body;

    if (!Array.isArray(courseIds) || courseIds.length === 0) {
      return next(new ApiError(400, "courseIds is required"));
    }

    if (req.user.role === "ADMIN") {
      return next();
    }

    if (req.user.role !== "INSTRUCTOR") {
      return next(new ApiError(403, "Forbidden: insufficient role"));
    }

    const courses = await prisma.course.findMany({
      where: { id: { in: courseIds } },
      select: { id: true, creatorId: true },
    });

    if (courses.length !== new Set(courseIds).size) {
      return next(new ApiError(404, "One or more courses not found"));
    }

    const ownsAll = courses.every((course) => course.creatorId === req.user.id);

    if (!ownsAll) {
      return next(new ApiError(403, "Forbidden: you do not own all of these courses"));
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  verifyBatchOwnership,
  verifyBatchOwnershipFromBody,
  verifyBatchCourseIdsOwnership,
};
