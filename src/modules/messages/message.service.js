const prisma = require("../../config/database");

const MESSAGE_EXPIRY_DAYS = 7;

const formatMessage = (msg) => {
    if (!msg) return msg;
    const formatted = { ...msg };
    if (msg.User) {
        formatted.sender = msg.User;
        delete formatted.User;
    }
    if (msg.messageAttachments) {
        formatted.attachments = msg.messageAttachments;
    }
    return formatted;
};

const getMessages = async (conversationId, userId) => {
    const conversation = await prisma.conversation.findFirst({
        where: {
            id: conversationId,
            participants: {
                some: {
                    userId,
                },
            },
        },
    });

    if (!conversation) {
        const error = new Error("Conversation not found.");
        error.statusCode = 404;
        throw error;
    }

    const messages = await prisma.message.findMany({
        where: {
            conversationId,
            isDeleted: false,
        },
        include: {
            sender: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                },
            },
            messageAttachments: {
                select: {
                    id: true,
                    fileName: true,
                    fileUrl: true,
                    mimeType: true,
                    size: true,
                    type: true,
                    createdAt: true,
                },
            },
        },
        orderBy: {
            createdAt: "asc",
        },
    });

    return messages.map(formatMessage);
};

const getMessageById = async (messageId, userId) => {
    const message = await prisma.message.findFirst({
        where: {
            id: messageId,
            Conversation: {
                participants: {
                    some: {
                        userId,
                    },
                },
            },
            isDeleted: false,
        },
        include: {
            sender: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                },
            },
            messageAttachments: {
                select: {
                    id: true,
                    fileName: true,
                    fileUrl: true,
                    mimeType: true,
                    size: true,
                    type: true,
                    createdAt: true,
                },
            },
        },
    });

    if (!message) {
        const error = new Error("Message not found.");
        error.statusCode = 404;
        throw error;
    }

    return formatMessage(message);
};

const sendMessage = async (conversationId, senderId, data) => {
    const conversation = await prisma.conversation.findFirst({
        where: {
            id: conversationId,
            participants: {
                some: {
                    userId: senderId,
                },
            },
        },
    });

    if (!conversation) {
        const error = new Error("Conversation not found.");
        error.statusCode = 404;
        throw error;
    }

    return await prisma.$transaction(async (tx) => {
        const message = await tx.message.create({
            data: {
                conversationId,
                senderId,
                content: data.content || "",
                messageAttachments: data.attachments && data.attachments.length > 0 ? {
                    create: data.attachments.map((att) => ({
                        fileName: att.fileName,
                        fileUrl: att.fileUrl,
                        mimeType: att.mimeType,
                        size: att.size,
                        type: att.type,
                    })),
                } : undefined,
            },
            include: {
                sender: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        role: true,
                    },
                },
                messageAttachments: {
                    select: {
                        id: true,
                        fileName: true,
                        fileUrl: true,
                        mimeType: true,
                        size: true,
                        type: true,
                        createdAt: true,
                    },
                },
            },
        });

        await tx.conversation.update({
            where: {
                id: conversationId,
            },
            data: {
                updatedAt: new Date(),
            },
        });

        return formatMessage(message);
    });
};
const markConversationAsRead = async (conversationId, userId) => {
    const participant = await prisma.conversationParticipant.findFirst({
        where: {
            conversationId,
            userId,
        },
    });

    if (!participant) {
        const error = new Error("Conversation not found.");
        error.statusCode = 404;
        throw error;
    }

    return await prisma.conversationParticipant.update({
        where: {
            id: participant.id,
        },
        data: {
            lastReadAt: new Date(),
        },
    });
};


const deleteMessage = async (messageId, userId) => {
    const message = await prisma.message.findUnique({
        where: {
            id: messageId,
        },
    });

    if (!message) {
        const error = new Error("Message not found.");
        error.statusCode = 404;
        throw error;
    }

    if (message.senderId !== userId) {
        const error = new Error("You can delete only your own messages.");
        error.statusCode = 403;
        throw error;
    }

    return await prisma.message.update({
        where: {
            id: messageId,
        },
        data: {
            isDeleted: true,
            deletedAt: new Date(),
        },
    });
};

const editMessage = async (messageId, userId, content) => {
    const message = await prisma.message.findUnique({
        where: {
            id: messageId,
        },
    });

    if (!message) {
        const error = new Error("Message not found.");
        error.statusCode = 404;
        throw error;
    }

    if (message.isDeleted) {
        const error = new Error("Cannot edit a deleted message.");
        error.statusCode = 400;
        throw error;
    }

    if (message.senderId !== userId) {
        const error = new Error("You can edit only your own messages.");
        error.statusCode = 403;
        throw error;
    }

    const updatedMessage = await prisma.message.update({
        where: {
            id: messageId,
        },
        data: {
            content,
            isEdited: true,
            editedAt: new Date(),
        },
        include: {
            sender: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                },
            },
            messageAttachments: {
                select: {
                    id: true,
                    fileName: true,
                    fileUrl: true,
                    mimeType: true,
                    size: true,
                    type: true,
                    createdAt: true,
                },
            },
        },
    });

    return formatMessage(updatedMessage);
};

const toggleStarMessage = async (messageId, userId) => {
    throw new Error("Starring messages is not supported in this database schema configuration.");
};

module.exports = {
    getMessages,
    getMessageById,
    sendMessage,
    markConversationAsRead,
    deleteMessage,
    editMessage,
    toggleStarMessage,
};