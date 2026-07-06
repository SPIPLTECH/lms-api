const messageService = require("./message.service");

const getConversations = async (req, res, next) => {
    try {
        const conversations = await messageService.getConversations(req.user.id);

        return res.status(200).json({
            success: true,
            message: "Conversations fetched successfully.",
            data: conversations,
        });
    } catch (error) {
        next(error);
    }
};

const getConversationById = async (req, res, next) => {
    try {
        const conversation = await messageService.getConversationById(
            req.params.conversationId,
            req.user.id
        );

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: "Conversation not found.",
            });
        }

        return res.status(200).json({
            success: true,
            data: conversation,
        });
    } catch (error) {
        next(error);
    }
};

const createConversation = async (req, res, next) => {
    try {
        const conversation = await messageService.createConversation(
            req.body,
            req.user.id
        );

        return res.status(201).json({
            success: true,
            message: "Conversation created successfully.",
            data: conversation,
        });
    } catch (error) {
        next(error);
    }
};

const updateConversation = async (req, res, next) => {
    try {
        const conversation = await messageService.updateConversation(
            req.params.conversationId,
            req.body
        );

        return res.status(200).json({
            success: true,
            message: "Conversation updated successfully.",
            data: conversation,
        });
    } catch (error) {
        next(error);
    }
};

const deleteConversation = async (req, res, next) => {
    try {
        await messageService.deleteConversation(req.params.conversationId);

        return res.status(200).json({
            success: true,
            message: "Conversation deleted successfully.",
        });
    } catch (error) {
        next(error);
    }
};

const getMessages = async (req, res, next) => {
    try {
        const messages = await messageService.getMessages(
            req.params.conversationId,
            req.user.id
        );

        return res.status(200).json({
            success: true,
            message: "Messages fetched successfully.",
            data: messages,
        });
    } catch (error) {
        next(error);
    }
};

const sendMessage = async (req, res, next) => {
    try {
        const message = await messageService.sendMessage(
            req.params.conversationId,
            req.user.id,
            req.body
        );

        return res.status(201).json({
            success: true,
            message: "Message sent successfully.",
            data: message,
        });
    } catch (error) {
        next(error);
    }
};

const markConversationAsRead = async (req, res, next) => {
    try {
        await messageService.markConversationAsRead(
            req.params.conversationId,
            req.user.id
        );

        return res.status(200).json({
            success: true,
            message: "Conversation marked as read.",
        });
    } catch (error) {
        next(error);
    }
};

const deleteMessage = async (req, res, next) => {
    try {
        await messageService.deleteMessage(
            req.params.messageId,
            req.user.id
        );

        return res.status(200).json({
            success: true,
            message: "Message deleted successfully.",
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getConversations,
    getConversationById,
    createConversation,
    updateConversation,
    deleteConversation,
    getMessages,
    sendMessage,
    markConversationAsRead,
    deleteMessage,
};