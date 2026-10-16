const ApiError = require("../utils/ApiError");
const courseOwnership = require("./courseOwnership.middleware");
const moduleOwnership = require("./moduleOwnership.middleware");
const lessonOwnership = require("./lessonOwnership.middleware");
const topicOwnership = require("./topicOwnership.middleware");
const subTopicOwnership = require("./subTopicOwnership.middleware");
const conceptOwnership = require("./conceptOwnership.middleware");

/**
 * Dispatches to whichever parent ownership check matches the parent field
 * present on req.body (courseId, moduleId, lessonId, topicId, subTopicId or
 * conceptId).
 *
 * Explicit table rather than the if/else chain it replaced, for the same
 * reason as contentParentOwnership: that chain ended in a bare
 * `return topicOwnership.fromBody(...)`, so any unmatched body fell through
 * to the topic check. An unmatched body is now an explicit 400.
 */
const HANDLERS = [
  ["courseId", courseOwnership],
  ["moduleId", moduleOwnership],
  ["lessonId", lessonOwnership],
  ["topicId", topicOwnership],
  ["subTopicId", subTopicOwnership],
  ["conceptId", conceptOwnership],
];

const fromBody = (req, res, next) => {
  const match = HANDLERS.find(([field]) => req.body?.[field]);

  if (!match) {
    return next(
      new ApiError(
        400,
        "Assignment must be attached to exactly one of course, module, lesson, topic, subtopic, or concept."
      )
    );
  }

  return match[1].fromBody(req, res, next);
};

module.exports = { fromBody };
