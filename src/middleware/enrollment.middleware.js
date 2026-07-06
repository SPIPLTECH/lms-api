const prisma = require("../config/database");

const checkEnrollmentAccess = async (
  req,
  res,
  next
) => {
  try {
    if (req.user.role === "ADMIN") {
      return next();
    }

    if (req.user.role !== "STUDENT") {
      return res.status(403).json({
        success: false,
        message: "Access denied"
      });
    }

    const student =
      await prisma.studentProfile.findUnique({
        where: {
          userId: req.user.id
        }
      });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student profile not found"
      });
    }

    req.studentId = student.id;

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = checkEnrollmentAccess;