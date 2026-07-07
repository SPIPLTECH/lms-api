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

const sendMessage = async (req, res, next) => {
    try {
        const message = await messageService.sendMessage(
            req.body.conversationId,
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

const markMessageAsRead = async (req, res, next) => {
    try {
        await messageService.markMessageAsRead(
            req.params.messageId,
            req.user.id
        );

        return res.status(200).json({
            success: true,
            message: "Message marked as read.",
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
    sendMessage,
    markMessageAsRead,
    deleteMessage,
};