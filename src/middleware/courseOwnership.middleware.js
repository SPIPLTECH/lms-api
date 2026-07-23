const prisma = require("../config/database");

const verifyCourseOwnership = async (
  req,
  res,
  next
) => {
  try {
    const { courseId } = req.params;

    const course =
      await prisma.course.findUnique({
        where: {
          id: courseId
        }
      });

    if (!course) {
      return res.status(404).json({
        message: "Course not found"
      });
    }

    if (req.user.role === "ADMIN") {
      return next();
    }

    if (req.user.role === "INSTRUCTOR") {
      if (course.creatorId !== req.user.id) {
        return res.status(403).json({
          message: "Forbidden: You do not have permission to manage this course"
        });
      }
      return next();
    }

    return res.status(403).json({
      message: "Forbidden: Unauthorized access"
    });
  } catch (error) {
    next(error);
  }
};

module.exports = verifyCourseOwnership;