const courseOwnership = require("./courseOwnership.middleware");
const moduleOwnership = require("./moduleOwnership.middleware");
const lessonOwnership = require("./lessonOwnership.middleware");
const topicOwnership = require("./topicOwnership.middleware");

/**
 * Dispatches to whichever parent ownership check matches the parent field present on req.body
 * (courseId, moduleId, lessonId, or topicId).
 */
const fromBody = (req, res, next) => {
  if (req.body.courseId) return courseOwnership.fromBody(req, res, next);
  if (req.body.moduleId) return moduleOwnership.fromBody(req, res, next);
  if (req.body.lessonId) return lessonOwnership.fromBody(req, res, next);
  return topicOwnership.fromBody(req, res, next);
};

module.exports = { fromBody };
