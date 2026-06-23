const prisma =
  require("../config/database");

const verifyLessonOwnership =
  async (req, res, next) => {
    try {
      const lesson =
        await prisma.lesson.findUnique({
          where: {
            id: req.params.lessonId
          },
          include: {
            module: {
              include: {
                course: true
              }
            }
          }
        });

      if (!lesson) {
        return res.status(404).json({
          message:
            "Lesson not found"
        });
      }

      if (
        req.user.role !==
          "ADMIN" &&
        lesson.module.course
          .creatorId !==
          req.user.id
      ) {
        return res.status(403).json({
          message:
            "Access denied"
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };

module.exports =
  verifyLessonOwnership;