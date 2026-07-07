const prisma = require("../../config/database");

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
        throw new Error("Conversation not found.");
    }

    return await prisma.message.findMany({
        where: {
            conversationId,
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
};

const sendMessage = async (
    conversationId,
    senderId,
    data
) => {
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
        throw new Error("Conversation not found.");
    }

    return await prisma.message.create({
        data: {
            conversationId,
            senderId,
            content: data.content,
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
        },
    });
};

const markConversationAsRead = async (
    conversationId,
    userId
) => {
    const participant =
        await prisma.conversationParticipant.findFirst({
            where: {
                conversationId,
                userId,
            },
        });

    if (!participant) {
        throw new Error("Conversation not found.");
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

const deleteMessage = async (
    messageId,
    userId
) => {
    const message = await prisma.message.findUnique({
        where: {
            id: messageId,
        },
    });

    if (!message) {
        throw new Error("Message not found.");
    }

    if (message.senderId !== userId) {
        throw new Error(
            "You can delete only your own messages."
        );
    }

    return await prisma.message.update({
        where: {
            id: messageId,
        },
        data: {
            isDeleted: true,
            deletedAt: new Date(),
            content: "This message was deleted.",
        },
    });
};

module.exports = {
    getMessages,
    sendMessage,
    markConversationAsRead,
    deleteMessage,
};