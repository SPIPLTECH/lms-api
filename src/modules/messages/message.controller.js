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
            const prisma = require("../../config/database");
            const io = getIO();

            io.to(req.body.conversationId).emit("receive_message", message);
            io.to(req.body.conversationId).emit("message:new", message);

            const conv = await prisma.conversation.findUnique({
                where: { id: req.body.conversationId },
                include: { participants: true },
            });
            if (conv && conv.participants) {
                conv.participants.forEach((p) => {
                    io.to(`user_${p.userId}`).emit("receive_message", message);
                    io.to(`user_${p.userId}`).emit("message:new", message);
                });
            }
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

const editMessage = async (req, res, next) => {
    try {
        const message = await messageService.editMessage(
            req.params.messageId,
            req.user.id,
            req.body.content
        );

        try {
            const { getIO } = require("../../socket");
            const io = getIO();
            io.to(message.conversationId).emit("message:edit", message);
        } catch (socketError) {
            console.error("Failed to broadcast message edit via socket:", socketError);
        }

        return res.status(200).json({
            success: true,
            message: "Message edited successfully.",
            data: message,
        });
    } catch (error) {
        next(error);
    }
};

const toggleStarMessage = async (req, res, next) => {
    try {
        const message = await messageService.toggleStarMessage(
            req.params.messageId,
            req.user.id
        );

        try {
            const { getIO } = require("../../socket");
            const io = getIO();
            io.to(message.conversationId).emit("message:star", message);
        } catch (socketError) {
            console.error("Failed to broadcast message star via socket:", socketError);
        }

        return res.status(200).json({
            success: true,
            message: message.isStarred ? "Message starred." : "Message unstarred.",
            data: message,
        });
    } catch (error) {
        next(error);
    }
};

const uploadAttachment = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded.",
            });
        }

        const { getAttachmentType } = require("../../middleware/upload.middleware");
        const type = getAttachmentType(req.file.mimetype, req.file.originalname);
        const fileUrl = `/uploads/attachments/${req.file.filename}`;

        return res.status(200).json({
            success: true,
            message: "File uploaded successfully.",
            data: {
                fileName: req.file.originalname,
                fileUrl,
                mimeType: req.file.mimetype,
                size: req.file.size,
                type,
            },
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
    editMessage,
    toggleStarMessage,
    uploadAttachment,
};