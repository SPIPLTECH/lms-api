const prisma = require("../config/database");
const { buildOwnershipCheck } = require("./ownership.middleware");

const COURSE_CREATOR = { select: { creatorId: true } };
const MODULE_NODE = { include: { course: COURSE_CREATOR } };
const LESSON_NODE = { include: { module: MODULE_NODE } };
const TOPIC_NODE = { include: { lesson: LESSON_NODE } };
const SUBTOPIC_NODE = { include: { topic: TOPIC_NODE } };
const CONCEPT_NODE = { include: { subTopic: SUBTOPIC_NODE } };

// Assignment hangs off exactly one of six levels, so ownership has to be
// resolvable from any of them. Composed from shared fragments so the six
// branches cannot drift apart.
const findAssignmentById = (id) =>
  prisma.assignment.findUnique({
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

const getCourseCreatorId = (assignment) =>
  assignment.course?.creatorId ??
  assignment.module?.course?.creatorId ??
  assignment.lesson?.module?.course?.creatorId ??
  assignment.topic?.lesson?.module?.course?.creatorId ??
  assignment.subTopic?.topic?.lesson?.module?.course?.creatorId ??
  assignment.concept?.subTopic?.topic?.lesson?.module?.course?.creatorId;

/**
 * Verifies the caller owns the course behind req.params.assignmentId.
 * ADMIN always passes.
 */
const verifyAssignmentOwnership = buildOwnershipCheck({
  getResourceId: (req) => req.params.assignmentId,
  findResource: findAssignmentById,
  getCourseCreatorId,
  notFoundMessage: "Assignment not found",
  missingIdMessage: "assignmentId is required",
  attachAs: "assignment",
});

module.exports = verifyAssignmentOwnership;
module.exports.verifyAssignmentOwnership = verifyAssignmentOwnership;
