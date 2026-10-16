const prisma = require("../config/database");
const { buildOwnershipCheck } = require("./ownership.middleware");

// SubTopic sits one level below Topic, so the walk up to the owning course is
// the Topic walk plus one hop: subTopic -> topic -> lesson -> module -> course.
const findSubTopicById = (id) =>
  prisma.subTopic.findUnique({
    where: { id },
    include: {
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

const getCourseCreatorId = (subTopic) =>
  subTopic.topic?.lesson?.module?.course?.creatorId;

const verifySubTopicOwnership = buildOwnershipCheck({
  getResourceId: (req) => req.params.subTopicId,
  findResource: findSubTopicById,
  getCourseCreatorId,
  notFoundMessage: "SubTopic not found",
  missingIdMessage: "subTopicId is required",
  attachAs: "subTopic",
});

/**
 * Same ownership check, keyed on req.body.subTopicId instead of a URL param.
 * Used when creating a child resource (concept, content, quiz, assignment)
 * under a subtopic.
 */
const verifySubTopicOwnershipFromBody = buildOwnershipCheck({
  getResourceId: (req) => req.body.subTopicId,
  findResource: findSubTopicById,
  getCourseCreatorId,
  notFoundMessage: "SubTopic not found",
  missingIdMessage: "subTopicId is required",
  attachAs: "subTopic",
});

module.exports = verifySubTopicOwnership;
module.exports.verifySubTopicOwnership = verifySubTopicOwnership;
module.exports.fromBody = verifySubTopicOwnershipFromBody;
