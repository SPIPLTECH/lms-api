const prisma = require("../../config/database");
const messagingPermissionService = require("../permissions/messagingPermission.service");


const formatLastSeen = (date) => {
    if (!date) return "";
    const now = new Date();
    const d = new Date(date);
    
    // Check if same day
    if (d.toDateString() === now.toDateString()) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    // Check if yesterday
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
        return "Yesterday";
    }
    
    // Older
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatConversation = async (conversation, currentUserId) => {
    const formattedConversation = { ...conversation };

    if (conversation.type === "DIRECT") {
        const otherParticipant = conversation.participants.find(
            (participant) => participant.userId !== currentUserId
        );

        if (otherParticipant) {
            formattedConversation.name = otherParticipant.user.name;
        }
    }

    // Fetch last message of this conversation
    const lastMsg = await prisma.message.findFirst({
        where: {
            conversationId: conversation.id,
            isDeleted: false,
        },
        orderBy: {
            createdAt: "desc",
        },
        include: {
            messageAttachments: {
                take: 1,
            },
        },
    });

    if (lastMsg) {
        let text = "";
        if (lastMsg.content && lastMsg.content.trim()) {
            text = lastMsg.content;
        } else if (lastMsg.messageAttachments && lastMsg.messageAttachments.length > 0) {
            const type = lastMsg.messageAttachments[0].type;
            if (type === "IMAGE") text = "📷 Photo";
            else if (type === "VIDEO") text = "🎥 Video";
            else if (type === "AUDIO") text = "🎵 Audio";
            else if (type === "DOCUMENT") text = "📄 Document";
            else text = "📎 Attachment";
        }
        formattedConversation.lastMessage = text;
        formattedConversation.lastSeen = formatLastSeen(lastMsg.createdAt);
    } else {
        formattedConversation.lastMessage = "";
        formattedConversation.lastSeen = "";
    }

    return formattedConversation;
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

    return await Promise.all(
        conversations.map((conversation) =>
            formatConversation(conversation, userId)
        )
    );
};

const getConversationById = async (conversationId, userId) => {
    const conversation = await prisma.conversation.findFirst({
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

    if (!conversation) {
        return null;
    }

    return await formatConversation(conversation, userId);
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
            },
        });

        if (
            existingConversation &&
            existingConversation.participants.length === 2
        ) {
            return formatConversation(existingConversation, userId);
        }
    }

    const conversation = await prisma.conversation.create({
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

    const formattedConversation = formatConversation(conversation, userId);

    // console.log("Returning Conversation:");
    // console.log(formattedConversation);

    return formattedConversation;
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