const express = require("express");

const router = express.Router();

const verifyToken = require("../../middleware/auth.middleware");
const { optionalToken } = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const {
  aiAssistantGuestRateLimiter,
  aiAssistantUserRateLimiter,
} = require("../../middleware/rateLimit.middleware");

const controller = require("./aiAssistant.controller");
const {
  guestMessageSchema,
  conversationMessageSchema,
  createConversationSchema,
  updateConversationSchema,
  conversationIdParamSchema,
} = require("./aiAssistant.validation");

/* ------------------------------------------------------------------ */
/* Public / guest                                                      */
/* ------------------------------------------------------------------ */

/**
 * Anonymous course-page assistant.
 *
 * `optionalToken` rather than `verifyToken`: a visitor with no token must be
 * able to reach this, and a bad or expired token degrades to GUEST instead of
 * 401. The scope is still decided server-side — a signed-in caller who hits
 * this endpoint is resolved to their real scope, they do not get to
 * self-select GUEST or anything above it.
 *
 * Deliberately no checkRole: GUEST is exactly who this is for.
 */
router.post(
  "/guest/messages/stream",
  optionalToken,
  aiAssistantGuestRateLimiter,
  validate(guestMessageSchema, "body"),
  controller.streamGuestMessage
);

/* ------------------------------------------------------------------ */
/* Authenticated                                                       */
/* ------------------------------------------------------------------ */

// Everything below requires a real session. Role is checked broadly here;
// what a caller may actually see is decided by resolveScope per course, not
// by role.
router.use(verifyToken);
router.use(checkRole(["STUDENT", "INSTRUCTOR", "ADMIN"]));

router.post(
  "/conversations",
  validate(createConversationSchema, "body"),
  controller.createConversation
);

router.get("/conversations", controller.listConversations);

router.get(
  "/conversations/:conversationId/messages",
  validate(conversationIdParamSchema, "params"),
  controller.getConversationMessages
);

router.post(
  "/conversations/:conversationId/messages/stream",
  aiAssistantUserRateLimiter,
  validate(conversationIdParamSchema, "params"),
  validate(conversationMessageSchema, "body"),
  controller.streamConversationMessage
);

router.patch(
  "/conversations/:conversationId",
  validate(conversationIdParamSchema, "params"),
  validate(updateConversationSchema, "body"),
  controller.updateConversation
);

router.delete(
  "/conversations/:conversationId",
  validate(conversationIdParamSchema, "params"),
  controller.deleteConversation
);

module.exports = router;
