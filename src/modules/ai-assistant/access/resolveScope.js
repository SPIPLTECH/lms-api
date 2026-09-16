const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");
const { SCOPE } = require("../constants/aiAssistant.constants");
const { findEnrollment } = require("./requireEnrollment");

/**
 * THE central access-control boundary for the AI Assistant.
 *
 * Everything downstream — which retriever runs, which prompt loads, what the
 * model is allowed to see — is selected from this function's return value and
 * from nothing else. No controller re-derives access, and no client field can
 * influence the outcome: `user` comes from the verified JWT (or is the GUEST
 * sentinel set by optionalToken), and enrollment is read from the database.
 *
 * Deliberately returns a scope rather than throwing for the
 * authenticated-but-not-enrolled case: BROWSING is a legitimate, useful mode,
 * not an error. It throws only when the course itself is unreachable.
 *
 * @param {{id?: string, role?: string}} user  req.user — GUEST has no id
 * @param {string|null} courseId               untrusted pointer from the client
 * @returns {Promise<{scope, userId, role, courseId, course, enrollment}>}
 */
const resolveScope = async (user, courseId) => {
  const role = user?.role || "GUEST";
  const userId = role === "GUEST" ? null : user?.id || null;

  // A conversation with no course attached is general-purpose. An
  // authenticated user gets BROWSING (they are known but no course is in
  // play); an anonymous one gets GUEST.
  if (!courseId) {
    return {
      scope: userId ? SCOPE.BROWSING : SCOPE.GUEST,
      userId,
      role,
      courseId: null,
      course: null,
      enrollment: null,
    };
  }

  // Only the fields needed to decide access. The content tree is fetched
  // later, by the context layer, and only once access has been granted.
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, status: true, visibility: true, creatorId: true, title: true },
  });

  if (!course) {
    throw new ApiError(404, "Course not found.");
  }

  const enrollment = userId ? await findEnrollment(userId, courseId) : null;

  // An enrolled student keeps access to a course that has since been
  // unpublished or archived — they paid for it. Everyone else may only reach
  // a PUBLISHED course, which is the same rule course.service.js applies.
  if (!enrollment && course.status !== "PUBLISHED") {
    throw new ApiError(404, "Course not found.");
  }

  if (enrollment) {
    return { scope: SCOPE.ENROLLED, userId, role, courseId, course, enrollment };
  }

  return {
    scope: userId ? SCOPE.BROWSING : SCOPE.GUEST,
    userId,
    role,
    courseId,
    course,
    enrollment: null,
  };
};

/** True only for the one scope permitted to see lesson/topic/content bodies. */
const canAccessLearningContent = (scope) => scope === SCOPE.ENROLLED;

module.exports = { resolveScope, canAccessLearningContent };
