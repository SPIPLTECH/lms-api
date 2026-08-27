const ApiError = require("../../../utils/ApiError");

/**
 * Resolves req.teacherInsightActor = { userId, role } for every route.
 * Unlike every other agent's resolve*Access middleware, there's no
 * StudentProfile lookup here — Course.creatorId references User.id
 * directly, so the authenticated user's own id is already the right
 * identity to authorize against.
 */
const resolveTeacherAccess = (req, res, next) => {
  const { id: userId, role } = req.user || {};

  if (!userId || role === "GUEST") {
    return next(new ApiError(401, "Authentication required to access teacher insights"));
  }

  if (role === "STUDENT") {
    return next(new ApiError(403, "Only instructors and admins may access teacher insights"));
  }

  req.teacherInsightActor = { userId, role };
  next();
};

module.exports = resolveTeacherAccess;
