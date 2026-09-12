const express = require("express");

const router = express.Router();

const topicController = require("./topic.controller");

const verifyToken = require("../../middleware/auth.middleware");

const checkRole = require("../../middleware/role.middleware");

const verifyTopicOwnership = require("../../middleware/topicOwnership.middleware");
const verifyLessonOwnership = require("../../middleware/lessonOwnership.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const {
  createTopicSchema,
  updateTopicSchema,
  reorderTopicsSchema,
} = require("./topic.validation");

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  topicController.getTopics
);

router.get(
  "/:topicId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  topicController.getTopicById
);

router.post(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  validate(createTopicSchema),
  verifyLessonOwnership.fromBody,
  topicController.createTopic
);

router.put(
  "/:topicId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyTopicOwnership,
  validate(updateTopicSchema),
  topicController.updateTopic
);

router.delete(
  "/:topicId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyTopicOwnership,
  topicController.deleteTopic
);

router.patch(
  "/reorder",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  validate(reorderTopicsSchema),
  verifyLessonOwnership.fromBody,
  topicController.reorderTopics
);

module.exports = router;
