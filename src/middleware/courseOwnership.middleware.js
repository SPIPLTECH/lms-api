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

    if (
      req.user.role !== "ADMIN" &&
      course.creatorId !== req.user.id
    ) {
      return res.status(403).json({
        message: "Access denied"
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = verifyCourseOwnership;