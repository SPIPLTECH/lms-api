const prisma = require("../../config/database");
const messagingPermissionService = require("../permissions/messagingPermission.service");

const getConversations = async (userId) => {
    return await prisma.conversation.findMany({
        where: {
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

        orderBy: {
            updatedAt: "desc",
        },
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

        await messagingPermissionService.canCreateConversation(
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
    isParticipant
};