const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");
const { assertCourseAccess } = require("../utils/accessControl.util");

/**
 * Factory: extracts a courseId via `getCourseId(req)` (varies by route —
 * params.courseId, query.courseId, or body.courseId), fetches the course,
 * and asserts the authenticated instructor owns it (or is an admin) before
 * the controller runs. Attaches req.course for the controller to reuse.
 *
 * @param {(req: import('express').Request) => string|undefined} getCourseId
 */
const resolveCourseAccess = (getCourseId) => {
  return async (req, res, next) => {
    try {
      const courseId = getCourseId(req);
      if (!courseId) throw new ApiError(400, "courseId is required");

      const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, title: true, creatorId: true } });
      if (!course) throw new ApiError(404, "Course not found");

      assertCourseAccess(req.teacherInsightActor, course);
      req.course = course;
      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = resolveCourseAccess;
