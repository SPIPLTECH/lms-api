const prisma = require("../config/database");
const ApiError = require("../utils/ApiError");

/**
 * Lets a STUDENT reach only their own student profile (`:studentId` is a
 * StudentProfile id). The roles in `staffRoles` keep access to any profile.
 *
 * Previously GET /students/:studentId had no role or ownership check and PUT
 * allowed any STUDENT, so one student could read another's full account
 * record (including the password hash and reset code) or edit their profile
 * by changing the id.
 */
const verifyStudentOwnership = (staffRoles = []) => async (req, res, next) => {
  try {
    if (!req.user) {
      return next(new ApiError(401, "Authentication required"));
    }

    if (staffRoles.includes(req.user.role)) return next();

    if (req.user.role !== "STUDENT") {
      return next(new ApiError(403, "Access denied"));
    }

    const own = await prisma.studentProfile.findUnique({
      where: { userId: req.user.id },
      select: { id: true },
    });

    if (!own || own.id !== req.params.studentId) {
      return next(new ApiError(403, "Forbidden: you can only access your own student profile"));
    }

    req.studentId = own.id;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = verifyStudentOwnership;
