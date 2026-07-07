const express = require("express");

const conversationController = require("./conversation.controller");
const verifyToken = require("../../middleware/auth.middleware");
const validate = require("../../middleware/joiValidation.middleware");

const {
    createConversationSchema,
    updateConversationSchema,
} = require("./conversation.validation");

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Conversation Routes
|--------------------------------------------------------------------------
*/

router.get(
    "/",
    verifyToken,
    conversationController.getConversations
);

router.get(
    "/:conversationId",
    verifyToken,
    conversationController.getConversationById
);

router.post(
    "/",
    verifyToken,
    validate(createConversationSchema),
    conversationController.createConversation
);

router.patch(
    "/:conversationId",
    verifyToken,
    validate(updateConversationSchema),
    conversationController.updateConversation
);

router.delete(
    "/:conversationId",
    verifyToken,
    conversationController.deleteConversation
);

module.exports = router;