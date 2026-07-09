const messageService = require("./message.service");

const getMessages = async (req, res, next) => {
    try {
        const messages = await messageService.getMessages(
            req.query.conversationId,
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

const getMessageById = async (req, res, next) => {
    try {
        const message = await messageService.getMessageById(
            req.params.messageId,
            req.user.id
        );

        return res.status(200).json({
            success: true,
            message: "Message fetched successfully.",
            data: message,
        });
    } catch (error) {
        next(error);
    }
};

const sendMessage = async (req, res, next) => {
    try {
        const message = await messageService.sendMessage(
            req.body.conversationId,
            req.user.id,
            req.body
        );

        try {
            const { getIO } = require("../../socket");
            const io = getIO();
            io.to(req.body.conversationId).emit("receive_message", message);
            io.to(req.body.conversationId).emit("message:new", message);
        } catch (socketError) {
            console.error("Failed to broadcast message via socket:", socketError);
        }

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
    getMessages,
    getMessageById,
    sendMessage,
    markConversationAsRead,
    deleteMessage,
};