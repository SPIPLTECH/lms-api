const courseOwnership = require("./courseOwnership.middleware");
const moduleOwnership = require("./moduleOwnership.middleware");
const lessonOwnership = require("./lessonOwnership.middleware");
const topicOwnership = require("./topicOwnership.middleware");

/**
 * Dispatches to whichever of the four existing "does this INSTRUCTOR own
 * the course behind this parent" checks matches the parent field present on
 * req.body — the same rules Topic content already enforces, applied
 * identically at every level. No new authorization logic lives here.
 */
const fromBody = (req, res, next) => {
  if (req.body.courseId) return courseOwnership.fromBody(req, res, next);
  if (req.body.moduleId) return moduleOwnership.fromBody(req, res, next);
  if (req.body.lessonId) return lessonOwnership.fromBody(req, res, next);
  return topicOwnership.fromBody(req, res, next);
};

module.exports = { fromBody };
