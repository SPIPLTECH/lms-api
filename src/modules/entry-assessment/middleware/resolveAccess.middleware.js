const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");

/**
 * Resolves req.actor = { userId, role, studentId } for every entry-assessment
 * route (both the /assessment/entry/* and /student-state/course/:courseId
 * sub-routers). Same shape as the (removed) assessment/student-state agents'
 * own resolveStudentAccess middleware — consolidated into one copy since
 * both were byte-identical logic.
 */
const resolveAccess = async (req, res, next) => {
  try {
    const { id: userId, role } = req.user || {};

    if (!userId || role === "GUEST") {
      throw new ApiError(401, "Authentication required to access entry-assessment data");
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

    req.actor = { userId, role, studentId };
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = resolveAccess;
