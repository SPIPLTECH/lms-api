const prisma = require("../../config/database");
const permissionService = require("./messagePermission.service");
const getConversations = async (userId) => {
    return await prisma.conversation.findMany({
        where: {
            participants: {
                some: {
                    userId
                }
            }
        },

        include: {
            participants: {
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            role: true
                        }
                    }
                }
            },

            messages: {
                orderBy: {
                    createdAt: "desc"
                },
                take: 1,
                include: {
                    sender: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                }
            }
        },

        orderBy: {
            updatedAt: "desc"
        }
    });
};
const getConversationById = async (conversationId, userId) => {
    return await prisma.conversation.findFirst({
        where: {
            id: conversationId,
            participants: {
                some: {
                    userId,
                },
            },
        },
        include: {
            participants: {
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            role: true,
                        },
                    },
                },
            },
        },
    });
};
const createConversation = async (data, userId) => {
    const participantIds = [...new Set([userId, ...data.participantIds])];

    if (
        data.type === "DIRECT" &&
        data.participantIds.includes(userId)
    ) {
        throw new Error("You cannot create a conversation with yourself.");
    }

    if (data.type === "DIRECT") {

        if (participantIds.length !== 2) {
            throw new Error(
                "Direct conversation must have exactly two participants."
            );
        }

        await permissionService.canMessage(
            userId,
            participantIds[1]
        );

        const existingConversation =
            await prisma.conversation.findFirst({
                where: {
                    type: "DIRECT",
                    AND: participantIds.map((participantId) => ({
                        participants: {
                            some: {
                                userId: participantId,
                            },
                        },
                    })),
                },
                include: {
                    participants: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    name: true,
                                    email: true,
                                    role: true,
                                },
                            },
                        },
                    },
                },
            });

        if (existingConversation) {
            return existingConversation;
        }
    }

    return await prisma.conversation.create({
        data: {
            type: data.type,
            name: data.type === "GROUP" ? data.name : null,
            createdById: userId,

            participants: {
                create: participantIds.map((participantId) => ({
                    userId: participantId,
                })),
            },
        },

        include: {
            participants: {
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            role: true,
                        },
                    },
                },
            },
        },
    });
};
const updateConversation = async (conversationId, data) => {
    return await prisma.conversation.update({
        where: {
            id: conversationId,
        },
        data: {
            name: data.name,
            image: data.image,
        },
    });
};

const deleteConversation = async (conversationId) => {
    return await prisma.conversation.delete({
        where: {
            id: conversationId,
        },
    });
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
        throw new Error("Conversation not found.");
    }

    const messages = await prisma.message.findMany({
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

    return messages;
};
const sendMessage = async (
    conversationId,
    senderId,
    data
) => {
    const conversation =
        await prisma.conversation.findFirst({
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
        throw new Error(
            "Conversation not found."
        );
    }

    const message =
        await prisma.message.create({
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

    return message;
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
        throw new Error(
            "Conversation not found."
        );
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
        throw new Error("Message not found.");
    }

    if (message.senderId !== userId) {
        throw new Error("You can delete only your own messages.");
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
    getConversations,
    getConversationById,
    createConversation,
    updateConversation,
    deleteConversation,
    getMessages,
    sendMessage,
    markConversationAsRead,
    deleteMessage
};