const express = require("express");
const router = express.Router();
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const { mentorRateLimiter } = require("../../middleware/rateLimit.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const mentorController = require("./mentor.controller");
const {
  createConversationSchema,
  sendMessageSchema,
  conversationIdParamSchema,
} = require("./mentor.validation");

// All mentor endpoints require authentication, valid role, and rate limiting
router.use(verifyToken);
router.use(checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]));
router.use(mentorRateLimiter);

router.post(
  "/conversations",
  validate(createConversationSchema, "body"),
  mentorController.createConversation
);

router.get(
  "/conversations",
  mentorController.getUserConversations
);

router.get(
  "/conversations/:conversationId/messages",
  validate(conversationIdParamSchema, "params"),
  mentorController.getConversationMessages
);

router.post(
  "/conversations/:conversationId/messages",
  validate(conversationIdParamSchema, "params"),
  validate(sendMessageSchema, "body"),
  mentorController.sendMessage
);

router.post(
  "/conversations/:conversationId/messages/stream",
  validate(conversationIdParamSchema, "params"),
  validate(sendMessageSchema, "body"),
  mentorController.sendMessageStream
);

module.exports = router;
