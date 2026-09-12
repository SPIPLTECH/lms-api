const express = require("express");

const messageController = require("./message.controller");
const verifyToken = require("../../middleware/auth.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { upload, sanitizeSvgUpload } = require("../../middleware/upload.middleware");

const {
    sendMessageSchema,
    updateMessageSchema,
} = require("./message.validation");

const router = express.Router();

/**
 * GET /messages?conversationId=...
 */
router.get(
    "/",
    verifyToken,
    messageController.getMessages
);

/**
 * POST /messages
 */
router.post(
    "/",
    verifyToken,
    validate(sendMessageSchema),
    messageController.sendMessage
);

/**
 * POST /messages/upload
 */
router.post(
    "/upload",
    verifyToken,
    upload.single("file"),
    sanitizeSvgUpload,
    messageController.uploadAttachment
);

/**
 * PATCH /messages/read/:conversationId
 */
router.patch(
    "/read/:conversationId",
    verifyToken,
    messageController.markConversationAsRead
);

/**
 * PATCH /messages/:messageId
 */
router.patch(
    "/:messageId",
    verifyToken,
    validate(updateMessageSchema),
    messageController.editMessage
);

/**
 * PATCH /messages/:messageId/star
 */
router.patch(
    "/:messageId/star",
    verifyToken,
    messageController.toggleStarMessage
);

/**
 * DELETE /messages/:messageId
 */
router.delete(
    "/:messageId",
    verifyToken,
    messageController.deleteMessage
);

module.exports = router;