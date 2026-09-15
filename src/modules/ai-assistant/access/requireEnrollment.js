const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");

/**
 * Resolves a User id to its StudentProfile id.
 *
 * This hop is the single most error-prone part of enrollment checking in
 * this codebase: `Enrollment.studentId` is a StudentProfile id, NOT a User
 * id. Comparing a User id against Enrollment.studentId silently matches
 * nothing, which fails open into "not enrolled" — safe here, but the same
 * mistake in the other direction would not be. Every caller goes through
 * this function rather than reaching for prisma.enrollment directly.
 *
 * @returns {Promise<string|null>} StudentProfile id, or null if the user has
 *   no student profile (e.g. an INSTRUCTOR or ADMIN account).
 */
const getStudentProfileId = async (userId) => {
  if (!userId) return null;
  const profile = await prisma.studentProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  return profile?.id || null;
};

/**
 * Non-throwing enrollment lookup — used by resolveScope, which needs to
 * distinguish BROWSING from ENROLLED rather than reject.
 */
const findEnrollment = async (userId, courseId) => {
  if (!userId || !courseId) return null;

  const studentId = await getStudentProfileId(userId);
  if (!studentId) return null;

  return prisma.enrollment.findUnique({
    where: { studentId_courseId: { studentId, courseId } },
    select: { id: true, studentId: true, courseId: true, progressPercent: true, completed: true },
  });
};

/**
 * Throwing enrollment gate — the hard boundary in front of any learning
 * content retrieval. Promoted from the inline pattern in
 * modules/entry-assessment/services/entryAssessment.service.js so the check
 * exists once instead of being re-derived per feature.
 *
 * Takes a USER id (what the JWT carries) and does the profile hop itself, so
 * no caller has to remember the distinction.
 *
 * @throws {ApiError} 403 when there is no active enrollment.
 */
const requireEnrollment = async (userId, courseId) => {
  const enrollment = await findEnrollment(userId, courseId);
  if (!enrollment) {
    throw new ApiError(403, "You must be enrolled in this course to use the assistant for its learning content.");
  }
  return enrollment;
};

module.exports = { requireEnrollment, findEnrollment, getStudentProfileId };
