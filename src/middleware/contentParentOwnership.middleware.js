const ApiError = require("../utils/ApiError");
const courseOwnership = require("./courseOwnership.middleware");
const moduleOwnership = require("./moduleOwnership.middleware");
const lessonOwnership = require("./lessonOwnership.middleware");
const topicOwnership = require("./topicOwnership.middleware");
const subTopicOwnership = require("./subTopicOwnership.middleware");
const conceptOwnership = require("./conceptOwnership.middleware");

/**
 * Dispatches to whichever of the six existing "does this INSTRUCTOR own the
 * course behind this parent" checks matches the parent field present on
 * req.body — the same rules Topic content already enforced, applied
 * identically at every level. No new authorization logic lives here.
 *
 * Note this is an explicit table rather than the if/else chain it replaced.
 * That chain ended in a bare `return topicOwnership.fromBody(...)`, so ANY
 * body without a recognised parent field fell through to the topic check.
 * With six levels that fallthrough would have silently mis-dispatched
 * SubTopic/Concept bodies to the topic middleware, which would then 400 on a
 * missing topicId rather than actually checking ownership. An unmatched body
 * is now an explicit 400.
 *
 * Reaching the unmatched branch normally requires bypassing
 * createContentSchema's .xor(), which already guarantees exactly one parent.
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
        "Content must be attached to exactly one of course, module, lesson, topic, subtopic, or concept."
      )
    );
  }

  return match[1].fromBody(req, res, next);
};

module.exports = { fromBody };
