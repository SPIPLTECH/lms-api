const ApiError = require("../../../utils/ApiError");

const STAFF_ROLES = ["ADMIN", "INSTRUCTOR"];
const isStaff = (role) => STAFF_ROLES.includes(role);

/**
 * A STUDENT actor may only ever resolve to their own studentId; staff must
 * explicitly name a target. Same rule as the Observation Agent's
 * resolveTargetStudentId — student-state data is just as sensitive.
 *
 * @param {{role: string, studentId: string|null}} actor
 * @param {string|undefined} requestedStudentId
 * @returns {string}
 */
const resolveTargetStudentId = (actor, requestedStudentId) => {
  if (actor.role === "STUDENT") {
    if (requestedStudentId && requestedStudentId !== actor.studentId) {
      throw new ApiError(403, "Students may only access their own learning state");
    }
    return actor.studentId;
  }

  if (!requestedStudentId) {
    throw new ApiError(400, "studentId is required for staff-initiated requests");
  }

  return requestedStudentId;
};

module.exports = { resolveTargetStudentId, isStaff, STAFF_ROLES };
