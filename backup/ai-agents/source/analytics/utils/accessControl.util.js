const ApiError = require("../../../utils/ApiError");
const { SCOPE_TYPE } = require("../constants");

/**
 * Three-way access split, reusing the shape of two precedents in this
 * codebase: STUDENT is locked to their own STUDENT-scope data (same rule
 * Recommendation/Motivation use), INSTRUCTOR is locked to their own
 * INSTRUCTOR-scope and own COURSE-scope data (Teacher Insight's rule), and
 * PLATFORM-scope + the Report/export subsystem are ADMIN-only — there's no
 * separate "platform owner" role in this schema, ADMIN is it.
 */

/** @param {{role: string, userId: string, studentId: string|null}} actor */
const assertStudentScopeAccess = (actor, targetStudentId) => {
  if (actor.role === "ADMIN") return;
  if (actor.role === "STUDENT" && actor.studentId === targetStudentId) return;
  throw new ApiError(403, "You do not have access to this student's analytics");
};

/** @returns {string} the resolved instructor id to query for. */
const assertInstructorScopeAccess = (actor, targetInstructorId) => {
  if (actor.role === "ADMIN") {
    if (!targetInstructorId) throw new ApiError(400, "instructorId is required for admin-initiated requests");
    return targetInstructorId;
  }

  if (actor.role === "INSTRUCTOR") {
    if (targetInstructorId && targetInstructorId !== actor.userId) {
      throw new ApiError(403, "Instructors may only access their own analytics");
    }
    return actor.userId;
  }

  throw new ApiError(403, "You do not have access to instructor analytics");
};

/** @param {{creatorId: string}} course - already fetched. */
const assertCourseScopeAccess = (actor, course) => {
  if (actor.role === "ADMIN") return;
  if (actor.role === "INSTRUCTOR" && course.creatorId === actor.userId) return;
  throw new ApiError(403, "You do not have access to this course's analytics");
};

const assertPlatformAccess = (actor) => {
  if (actor.role !== "ADMIN") throw new ApiError(403, "Platform analytics are restricted to administrators");
};

/** Role-aware default scope for GET /analytics/dashboard when no explicit scope is given. */
const resolveDefaultScope = (actor) => {
  if (actor.role === "ADMIN") return { scopeType: SCOPE_TYPE.PLATFORM, scopeId: null };
  if (actor.role === "INSTRUCTOR") return { scopeType: SCOPE_TYPE.INSTRUCTOR, scopeId: actor.userId };
  if (actor.role === "STUDENT") {
    if (!actor.studentId) throw new ApiError(404, "Student profile not found for the authenticated user");
    return { scopeType: SCOPE_TYPE.STUDENT, scopeId: actor.studentId };
  }
  throw new ApiError(403, "You do not have access to analytics");
};

module.exports = {
  assertStudentScopeAccess,
  assertInstructorScopeAccess,
  assertCourseScopeAccess,
  assertPlatformAccess,
  resolveDefaultScope,
};
