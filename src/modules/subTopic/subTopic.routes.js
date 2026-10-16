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
  reorderSubTopicsSchema,
} = require("./subTopic.validation");

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  subTopicController.getSubTopics
);

// Must stay above GET /:subTopicId, which would otherwise capture "reorder".
router.patch(
  "/reorder",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  validate(reorderSubTopicsSchema),
  verifyTopicOwnership.fromBody,
  subTopicController.reorderSubTopics
);

router.get(
  "/:subTopicId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
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
