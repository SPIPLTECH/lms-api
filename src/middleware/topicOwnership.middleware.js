const prisma = require("../config/database");
const { buildOwnershipCheck } = require("./ownership.middleware");

const findTopicById = (id) =>
  prisma.topic.findUnique({
    where: { id },
    include: {
      lesson: {
        include: {
          module: { include: { course: { select: { creatorId: true } } } },
        },
      },
    },
  });

const getCourseCreatorId = (topic) =>
  topic.lesson?.module?.course?.creatorId;

const verifyTopicOwnership = buildOwnershipCheck({
  getResourceId: (req) => req.params.topicId,
  findResource: findTopicById,
  getCourseCreatorId,
  notFoundMessage: "Topic not found",
  missingIdMessage: "topicId is required",
  attachAs: "topic",
});

/**
 * Same ownership check, keyed on req.body.topicId instead of a URL param.
 * Used when creating a child resource (content) under a topic.
 */
const verifyTopicOwnershipFromBody = buildOwnershipCheck({
  getResourceId: (req) => req.body.topicId,
  findResource: findTopicById,
  getCourseCreatorId,
  notFoundMessage: "Topic not found",
  missingIdMessage: "topicId is required",
  attachAs: "topic",
});

module.exports = verifyTopicOwnership;
module.exports.verifyTopicOwnership = verifyTopicOwnership;
module.exports.fromBody = verifyTopicOwnershipFromBody;
