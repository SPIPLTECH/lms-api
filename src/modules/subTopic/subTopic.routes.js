const express = require("express");

const router = express.Router();

const subTopicController = require("./subTopic.controller");

const verifyToken = require("../../middleware/auth.middleware");

const checkRole = require("../../middleware/role.middleware");

const verifySubTopicOwnership = require("../../middleware/subTopicOwnership.middleware");
const verifyTopicOwnership = require("../../middleware/topicOwnership.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const {
  createSubTopicSchema,
  updateSubTopicSchema,
} = require("./subTopic.validation");
const requireContentAccess = require("../../middleware/contentAccess.middleware");

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  requireContentAccess,
  subTopicController.getSubTopics
);

router.get(
  "/:subTopicId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  requireContentAccess,
  subTopicController.getSubTopicById
);

router.post(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  validate(createSubTopicSchema),
  verifyTopicOwnership.fromBody,
  subTopicController.createSubTopic
);

router.put(
  "/:subTopicId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifySubTopicOwnership,
  validate(updateSubTopicSchema),
  subTopicController.updateSubTopic
);

router.delete(
  "/:subTopicId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifySubTopicOwnership,
  subTopicController.deleteSubTopic
);

module.exports = router;
