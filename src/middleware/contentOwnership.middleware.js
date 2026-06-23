const prisma =
  require("../config/database");

const verifyContentOwnership =
  async (req, res, next) => {
    try {
      const content =
        await prisma.content.findUnique({
          where: {
            id: req.params.contentId
          },
          include: {
            lesson: {
              include: {
                module: {
                  include: {
                    course: true
                  }
                }
              }
            }
          }
        });

      if (!content) {
        return res.status(404).json({
          message:
            "Content not found"
        });
      }

      if (
        req.user.role !==
          "ADMIN" &&
        content.lesson.module.course
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
  verifyContentOwnership;