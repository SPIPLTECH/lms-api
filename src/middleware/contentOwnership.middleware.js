const prisma = require("../config/database");
const { buildOwnershipCheck } = require("./ownership.middleware");

const findContentById = (id) =>
  prisma.content.findUnique({
    where: { id },
    include: {
      course: { select: { creatorId: true } },
      module: { include: { course: { select: { creatorId: true } } } },
      lesson: { include: { module: { include: { course: { select: { creatorId: true } } } } } },
      topic: {
        include: {
          lesson: {
            include: {
              module: { include: { course: { select: { creatorId: true } } } },
            },
          },
        },
      },
    },
  });

const getCourseCreatorId = (content) =>
  content.course?.creatorId ??
  content.module?.course?.creatorId ??
  content.lesson?.module?.course?.creatorId ??
  content.topic?.lesson?.module?.course?.creatorId;

const verifyContentOwnership = buildOwnershipCheck({
  getResourceId: (req) => req.params.contentId,
  findResource: findContentById,
  getCourseCreatorId,
  notFoundMessage: "Content not found",
  missingIdMessage: "contentId is required",
  attachAs: "content",
});

module.exports = verifyContentOwnership;
module.exports.verifyContentOwnership = verifyContentOwnership;
