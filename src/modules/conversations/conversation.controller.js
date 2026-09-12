const conversationService = require("./conversation.service");

const getConversations = async (req, res, next) => {
    try {
        const conversations = await conversationService.getConversations(
            req.user.id
        );

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
        const conversation = await conversationService.getConversationById(
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
        const conversation = await conversationService.createConversation(
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
        const conversation = await conversationService.updateConversation(
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
        await conversationService.deleteConversation(
            req.params.conversationId
        );

        return res.status(200).json({
            success: true,
            message: "Conversation deleted successfully.",
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
};