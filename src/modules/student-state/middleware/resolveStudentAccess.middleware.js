const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");

/**
 * Resolves req.stateActor = { userId, role, studentId } for every
 * student-state route. Same pattern as the Observation Agent's
 * resolveStudentContext — kept as its own copy here rather than shared,
 * so each agent's HTTP layer stays independently deployable.
 */
const resolveStudentAccess = async (req, res, next) => {
  try {
    const { id: userId, role } = req.user || {};

    if (!userId || role === "GUEST") {
      throw new ApiError(401, "Authentication required to access student state");
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

    req.stateActor = { userId, role, studentId };
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = resolveStudentAccess;
