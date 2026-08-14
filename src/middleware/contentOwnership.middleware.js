const prisma = require("../config/database");
const { buildOwnershipCheck } = require("./ownership.middleware");

const findContentById = (id) =>
  prisma.content.findUnique({
    where: { id },
    include: {
      lesson: {
        include: {
          module: { include: { course: { select: { creatorId: true } } } },
        },
      },
    },
  });

const getCourseCreatorId = (content) =>
  content.lesson?.module?.course?.creatorId;

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

module.exports = verifyContentOwnership;
module.exports.verifyContentOwnership = verifyContentOwnership;
