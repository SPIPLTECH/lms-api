const prisma = require("../../config/database");
const messagingPermissionService = require("../permissions/messagingPermission.service");
const formatConversation = (conversation, currentUserId) => {
    const lastMessage = conversation.messages[0] || null;

    let name = conversation.name;
    let image = conversation.image;

    // For DIRECT conversations, use the other participant's details
    if (conversation.type === "DIRECT") {
        const otherParticipant = conversation.participants.find(
            (participant) => participant.userId !== currentUserId
        );

        if (otherParticipant) {
            name = otherParticipant.user.name;
            image = conversation.image;
        }
    }

    return {
        ...conversation,
        name,
        image,
        lastMessage,
        messages: undefined,
    };
};
const participantInclude = {
    include: {
        user: {
            select: {
                id: true,
                name: true,
            },
        },
    },
};

const getConversations = async (userId) => {
    const conversations = await prisma.conversation.findMany({
        where: {
            participants: {
                some: {
                    userId,
                },
            },
        },

        include: {
            participants: participantInclude,
        },

        orderBy: {
            updatedAt: "desc",
        },
    });

    return conversations.map((conversation) => {
        if (conversation.type === "DIRECT") {
            const otherParticipant = conversation.participants.find(
                (participant) => participant.userId !== userId
            );

            return {
                ...conversation,
                name: otherParticipant?.user?.name || conversation.name,
            };
        }

        return conversation;
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
            participants: participantInclude,
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

        await messagingPermissionService.canCreateConversation(
            userId,
            participantIds[1]
        );

        const existingConversation = await prisma.conversation.findFirst({
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
                participants: participantInclude,

                messages: {
                    orderBy: {
                        createdAt: "desc",
                    },
                    take: 1,
                    include: {
                        sender: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                },
            },
        });

        if (
            existingConversation &&
            existingConversation.participants.length === 2
        ) {
            return existingConversation;
        }
    }

    return await prisma.conversation.create({
        data: {
            type: data.type,
            name: data.type === "GROUP" ? data.name : null,
            description: data.type === "GROUP" ? data.description : null,
            image: data.type === "GROUP" ? data.image : null,
            createdById: userId,

            participants: {
                create: participantIds.map((participantId) => ({
                    userId: participantId,
                })),
            },
        },

        include: {
            participants: participantInclude,
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
            description: data.description,
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

const isParticipant = async (conversationId, userId) => {
    const participant = await prisma.conversationParticipant.findFirst({
        where: {
            conversationId,
            userId,
        },
    });

    return !!participant;
};

module.exports = {
    getConversations,
    getConversationById,
    createConversation,
    updateConversation,
    deleteConversation,
    isParticipant,
};