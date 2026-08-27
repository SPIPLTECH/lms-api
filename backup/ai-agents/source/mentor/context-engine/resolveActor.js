const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");
const { USER_ROLE } = require("../constants");

/**
 * Resolves the studentId/instructorId this actor needs for cross-agent
 * calls. STUDENT -> real StudentProfile.id lookup (same pattern every
 * student-scoped agent's resolveStudentAccess middleware already uses).
 * INSTRUCTOR -> userId itself (Course.creatorId convention, same as
 * Teacher Insight/Analytics' instructor scope — no separate profile table
 * to look up). ADMIN -> neither is needed.
 *
 * @param {{id: string, role: string}} user - req.user from auth middleware
 * @returns {Promise<import("../types/mentor.types").Actor>}
 */
const resolveActor = async (user) => {
  if (!user?.id || user.role === "GUEST") {
    throw new ApiError(401, "Authentication required to talk to the mentor");
  }

  if (user.role === USER_ROLE.STUDENT) {
    const studentProfile = await prisma.studentProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!studentProfile) throw new ApiError(404, "Student profile not found for the authenticated user");
    return { userId: user.id, role: USER_ROLE.STUDENT, studentId: studentProfile.id, instructorId: null };
  }

  if (user.role === USER_ROLE.INSTRUCTOR) {
    return { userId: user.id, role: USER_ROLE.INSTRUCTOR, studentId: null, instructorId: user.id };
  }

  if (user.role === USER_ROLE.ADMIN) {
    return { userId: user.id, role: USER_ROLE.ADMIN, studentId: null, instructorId: null };
  }

  throw new ApiError(403, "This role cannot use the AI Mentor");
};

module.exports = { resolveActor };
