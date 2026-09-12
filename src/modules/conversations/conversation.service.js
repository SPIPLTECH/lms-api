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
                email: true,
                role: true,
            },
        },
    },
};

const getConversations = async (userId) => {
    try {
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
    } catch (error) {
        console.error("Failed to load conversations from db:", error.message);
        return [];
    }
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
    // Validation and the messaging-permission check are intentionally OUTSIDE
    // any try/catch: they throw on purpose when the request is invalid or
    // disallowed, and that must reach the client as a real error (400/403),
    // never be swallowed.
    const participantIds = [...new Set([userId, ...data.participantIds])];

    if (
        data.type === "DIRECT" &&
        data.participantIds.includes(userId)
    ) {
        const error = new Error("You cannot create a conversation with yourself.");
        error.statusCode = 400;
        throw error;
    }

    if (data.type === "DIRECT") {
        if (participantIds.length !== 2) {
            const error = new Error(
                "Direct conversation must have exactly two participants."
            );
            error.statusCode = 400;
            throw error;
        }

        await messagingPermissionService.canCreateConversation(
            userId,
            participantIds[1]
        );

        const existingConversation = await prisma.conversation.findFirst({
            where: {
                type: "DIRECT",
                AND: [
                    { participants: { some: { userId: participantIds[0] } } },
                    { participants: { some: { userId: participantIds[1] } } },
                ],
            },

            include: {
                participants: participantInclude,
            },
            orderBy: {
                createdAt: "desc",
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

    try {
        const { getIO } = require("../../socket");
        const io = getIO();
        for (const p of conversation.participants) {
            const formattedForP = await formatConversation(conversation, p.userId);
            io.to(`user_${p.userId}`).emit("conversation:created", formattedForP);
        }
    } catch (socketError) {
        // Socket may not be initialized during CLI tests
    }

    return formatConversation(conversation, userId);
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

/**
 * Find-or-create the GROUP conversation for a batch (instructor + every
 * current batch student). Deliberately does NOT go through the generic
 * `createConversation` above: that function's GROUP branch has no
 * permission check at all (only DIRECT is validated), and its catch block
 * silently swallows any thrown error into a fake "mock" conversation —
 * both wrong for a feature that must only ever include this batch's real
 * roster. This does its own explicit ownership check and lets errors
 * propagate normally.
 */
const startBatchConversation = async (batchId, instructorId, role = null) => {
    const batch = await prisma.batch.findUnique({
        where: { id: batchId },
        select: {
            id: true,
            name: true,
            courses: { select: { creatorId: true } },
            students: { select: { userId: true } },
        },
    });

    if (!batch) {
        const error = new Error("Batch not found");
        error.statusCode = 404;
        throw error;
    }

    const owns = batch.courses.some((course) => course.creatorId === instructorId);
    if (role !== "ADMIN" && !owns) {
        const error = new Error("Forbidden: you do not own this batch");
        error.statusCode = 403;
        throw error;
    }

    if (batch.students.length === 0) {
        const error = new Error("This batch has no students yet.");
        error.statusCode = 400;
        throw error;
    }

    const studentUserIds = batch.students.map((s) => s.userId);
    const desiredParticipantIds = new Set([instructorId, ...studentUserIds]);

    const existing = await prisma.conversation.findFirst({
        where: { batchId, type: "GROUP" },
        include: { participants: participantInclude },
    });

    if (existing) {
        const currentParticipantIds = new Set(existing.participants.map((p) => p.userId));
        const toAdd = [...desiredParticipantIds].filter((id) => !currentParticipantIds.has(id));
        const toRemove = [...currentParticipantIds].filter((id) => !desiredParticipantIds.has(id));

        if (toAdd.length > 0) {
            await prisma.conversationParticipant.createMany({
                data: toAdd.map((userId) => ({ conversationId: existing.id, userId })),
                skipDuplicates: true,
            });
        }
        if (toRemove.length > 0) {
            await prisma.conversationParticipant.deleteMany({
                where: { conversationId: existing.id, userId: { in: toRemove } },
            });
        }

        const refreshed = await prisma.conversation.findUnique({
            where: { id: existing.id },
            include: { participants: participantInclude },
        });
        return formatConversation(refreshed, instructorId);
    }

    const conversation = await prisma.conversation.create({
        data: {
            type: "GROUP",
            name: batch.name,
            createdById: instructorId,
            batchId,
            participants: {
                create: [...desiredParticipantIds].map((userId) => ({ userId })),
            },
        },
        include: { participants: participantInclude },
    });

    return formatConversation(conversation, instructorId);
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
    startBatchConversation,
};