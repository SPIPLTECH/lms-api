const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");

/**
 * Resolves req.analyticsActor = { userId, role, studentId } for every
 * analytics route. Same shape as every other agent's resolve*Access
 * middleware — kept as its own copy per this codebase's per-agent
 * convention (each agent's HTTP layer stays independently deployable).
 */
const resolveAnalyticsAccess = async (req, res, next) => {
  try {
    const { id: userId, role } = req.user || {};

    if (!userId || role === "GUEST") {
      throw new ApiError(401, "Authentication required to access analytics");
    }

    let studentId = null;

    if (role === "STUDENT") {
      const studentProfile = await prisma.studentProfile.findUnique({ where: { userId }, select: { id: true } });
      if (!studentProfile) throw new ApiError(404, "Student profile not found for the authenticated user");
      studentId = studentProfile.id;
    }

    req.analyticsActor = { userId, role, studentId };
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = resolveAnalyticsAccess;
