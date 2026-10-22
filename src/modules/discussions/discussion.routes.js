const express = require("express");
const router = express.Router();

const controller = require("./discussion.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const requireContentAccess = require("../../middleware/contentAccess.middleware");
const {
  createDiscussionSchema,
  createReplySchema,
  updateDiscussionSchema
} = require("./discussion.validation");

// Access is enforced inside discussion.service.js (enrollment for students,
// ownership for instructors, always for admins) since read/post rights
// depend on course membership, not a simple role check.
// While a STUDENT device holds the playback lease, all discussion operations
// that expose course content are refused on the account's other devices.
router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  requireContentAccess,
  controller.getDiscussions
);

router.post(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  requireContentAccess,
  validate(createDiscussionSchema),
  controller.createDiscussion
);

router.post(
  "/:discussionId/replies",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  requireContentAccess,
  validate(createReplySchema),
  controller.replyToDiscussion
);

router.patch(
  "/:discussionId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  validate(updateDiscussionSchema),
  controller.updateDiscussion
);

router.delete(
  "/:discussionId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  requireContentAccess,
  controller.deleteDiscussion
);

router.delete(
  "/replies/:replyId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  requireContentAccess,
  controller.deleteReply
);

module.exports = router;
