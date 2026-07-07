const express = require("express");

const messageController = require("./message.controller");
const verifyToken = require("../../middleware/auth.middleware");
const validate = require("../../middleware/joiValidation.middleware");

const {
    sendMessageSchema,
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
 * DELETE /messages/:messageId
 */
router.delete(
    "/:messageId",
    verifyToken,
    messageController.deleteMessage
);

module.exports = router;