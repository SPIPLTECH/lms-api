const prisma = require("../config/database");
const ApiError = require("../utils/ApiError");

/**
 * Verifies a STUDENT can only mutate their own enrollment (matched via
 * req.studentId, set by checkEnrollmentAccess earlier in the chain). ADMIN
 * and INSTRUCTOR keep the full access checkEnrollmentAccess already grants
 * them and pass straight through.
 *
 * Previously DELETE /enrollments/:enrollmentId deleted by id alone with no
 * check that the enrollment belonged to the caller — any student could
 * unenroll any other student from any course.
 */
const verifyEnrollmentOwnership = async (req, res, next) => {
  try {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required"));
    }

    const { enrollmentId } = req.params;

    if (!enrollmentId) {
      return next(new ApiError(400, "enrollmentId is required"));
    }

    const enrollment = await prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: { id: true, studentId: true },
    });

    if (!enrollment) {
      return next(new ApiError(404, "Enrollment not found"));
    }

    if (req.user.role === "STUDENT" && enrollment.studentId !== req.studentId) {
      return next(
        new ApiError(403, "Forbidden: you can only manage your own enrollment")
      );
    }

    req.enrollment = enrollment;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = verifyEnrollmentOwnership;
module.exports.verifyEnrollmentOwnership = verifyEnrollmentOwnership;
