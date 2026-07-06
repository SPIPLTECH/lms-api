const express = require("express");
const validate = require("../../middleware/validate.middleware");

const {
    createConversationSchema,
    updateConversationSchema,
    sendMessageSchema,
} = require("./message.validation");
const messageController = require("./message.controller");
const verifyToken = require("../../middleware/auth.middleware");

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Conversation Routes
|--------------------------------------------------------------------------
*/

router.get(
    "/conversations",
    verifyToken,
    messageController.getConversations
);
router.get(
    "/conversations/:conversationId",
    verifyToken,
    messageController.getConversationById
);
router.post(
    "/conversations",
    verifyToken,
    validate(createConversationSchema),
    messageController.createConversation
);
router.patch(
    "/conversations/:conversationId",
    verifyToken,
    validate(updateConversationSchema),
    messageController.updateConversation
);
router.delete(
    "/conversations/:conversationId",
    verifyToken,
    messageController.deleteConversation
);
router.get(
    "/conversations/:conversationId/messages",
    verifyToken,
    messageController.getMessages
);
router.post(
    "/conversations/:conversationId/messages",
    verifyToken,
    validate(sendMessageSchema),
    messageController.sendMessage
);
router.patch(
    "/conversations/:conversationId/read",
    verifyToken,
    messageController.markConversationAsRead
);
router.delete(
    "/:messageId",
    verifyToken,
    messageController.deleteMessage
);
module.exports = router;