const ApiError = require("../../../utils/ApiError");

/**
 * Access control here is the inverse of every other agent's: those lock a
 * STUDENT actor to their own data. This agent has no student access at
 * all — only the INSTRUCTOR who owns the course (or an ADMIN, who can view
 * any course) may view its insights.
 */

/**
 * @param {{role: string, userId: string}} actor
 * @param {string|undefined} requestedTeacherId
 * @returns {string}
 */
const resolveTargetTeacherId = (actor, requestedTeacherId) => {
  if (actor.role === "ADMIN") {
    if (!requestedTeacherId) throw new ApiError(400, "teacherId is required for admin-initiated requests");
    return requestedTeacherId;
  }

  if (actor.role === "INSTRUCTOR") {
    if (requestedTeacherId && requestedTeacherId !== actor.userId) {
      throw new ApiError(403, "Instructors may only access their own teaching insights");
    }
    return actor.userId;
  }

  throw new ApiError(403, "Only instructors and admins may access teacher insights");
};

/**
 * @param {{role: string, userId: string}} actor
 * @param {{creatorId: string}} course - the course row, already fetched.
 */
const assertCourseAccess = (actor, course) => {
  if (actor.role === "ADMIN") return;
  if (actor.role === "INSTRUCTOR" && course.creatorId === actor.userId) return;
  throw new ApiError(403, "You do not have access to this course's insights");
};

module.exports = { resolveTargetTeacherId, assertCourseAccess };
