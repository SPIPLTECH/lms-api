const prisma = require("../config/database");
const { buildOwnershipCheck } = require("./ownership.middleware");

// Concept is the deepest container, so this is the longest walk in the app:
// concept -> subTopic -> topic -> lesson -> module -> course.
const findConceptById = (id) =>
  prisma.concept.findUnique({
    where: { id },
    include: {
      subTopic: {
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
      },
    },
  });

const getCourseCreatorId = (concept) =>
  concept.subTopic?.topic?.lesson?.module?.course?.creatorId;

const verifyConceptOwnership = buildOwnershipCheck({
  getResourceId: (req) => req.params.conceptId,
  findResource: findConceptById,
  getCourseCreatorId,
  notFoundMessage: "Concept not found",
  missingIdMessage: "conceptId is required",
  attachAs: "concept",
});

/**
 * Same ownership check, keyed on req.body.conceptId instead of a URL param.
 * Used when creating a child resource (content, quiz, assignment) under a
 * concept.
 */
const verifyConceptOwnershipFromBody = buildOwnershipCheck({
  getResourceId: (req) => req.body.conceptId,
  findResource: findConceptById,
  getCourseCreatorId,
  notFoundMessage: "Concept not found",
  missingIdMessage: "conceptId is required",
  attachAs: "concept",
});

module.exports = verifyConceptOwnership;
module.exports.verifyConceptOwnership = verifyConceptOwnership;
module.exports.fromBody = verifyConceptOwnershipFromBody;
