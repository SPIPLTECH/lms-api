const prisma = require("../config/database");
const { buildOwnershipCheck } = require("./ownership.middleware");

const COURSE_CREATOR = { select: { creatorId: true } };
const MODULE_NODE = { include: { course: COURSE_CREATOR } };
const LESSON_NODE = { include: { module: MODULE_NODE } };
const TOPIC_NODE = { include: { lesson: LESSON_NODE } };
const SUBTOPIC_NODE = { include: { topic: TOPIC_NODE } };
const CONCEPT_NODE = { include: { subTopic: SUBTOPIC_NODE } };

// Content hangs off exactly one of six levels, so ownership has to be
// resolvable from any of them. Composed from shared fragments so the six
// branches cannot drift apart.
const findContentById = (id) =>
  prisma.content.findUnique({
    where: { id },
    include: {
      course: COURSE_CREATOR,
      module: MODULE_NODE,
      lesson: LESSON_NODE,
      topic: TOPIC_NODE,
      subTopic: SUBTOPIC_NODE,
      concept: CONCEPT_NODE,
    },
  });

const getCourseCreatorId = (content) =>
  content.course?.creatorId ??
  content.module?.course?.creatorId ??
  content.lesson?.module?.course?.creatorId ??
  content.topic?.lesson?.module?.course?.creatorId ??
  content.subTopic?.topic?.lesson?.module?.course?.creatorId ??
  content.concept?.subTopic?.topic?.lesson?.module?.course?.creatorId;

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
