const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");

/**
 * Resolves req.observationActor for every observation route:
 *   { userId, role, studentId }
 *
 * STUDENT callers get their own StudentProfile.id attached automatically.
 * ADMIN/INSTRUCTOR callers act on behalf of a target student supplied via
 * params/body/query — resolved later by the controller, not here.
 *
 * Guests are rejected: LearningEvent.studentId is a required FK, so there
 * is no anonymous/unauthenticated event path in this version.
 */
const resolveStudentContext = async (req, res, next) => {
  try {
    const { id: userId, role } = req.user || {};

    if (!userId || role === "GUEST") {
      throw new ApiError(401, "Authentication required to record or read learning events");
    }

    let studentId = null;

    if (role === "STUDENT") {
      const studentProfile = await prisma.studentProfile.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (!studentProfile) {
        throw new ApiError(404, "Student profile not found for the authenticated user");
      }

      studentId = studentProfile.id;
    }

    req.observationActor = { userId, role, studentId };
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = resolveStudentContext;
