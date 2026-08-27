const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");

/**
 * Resolves req.assessmentActor = { userId, role, studentId } for every
 * assessment route. Same pattern as Observation's/Student State's
 * resolve*Context middleware — kept as its own copy per this codebase's
 * per-agent convention (each agent's HTTP layer stays independently
 * deployable).
 */
const resolveStudentAccess = async (req, res, next) => {
  try {
    const { id: userId, role } = req.user || {};

    if (!userId || role === "GUEST") {
      throw new ApiError(401, "Authentication required to access assessment data");
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

    req.assessmentActor = { userId, role, studentId };
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = resolveStudentAccess;
