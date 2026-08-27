const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");
const { assertCourseScopeAccess } = require("../utils/accessControl.util");

/** GET /analytics/course/:courseId — fetches the course and asserts the actor may see it before the controller runs. */
const resolveCourseAccess = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, creatorId: true } });
    if (!course) throw new ApiError(404, "Course not found");

    assertCourseScopeAccess(req.analyticsActor, course);
    req.course = course;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = resolveCourseAccess;
