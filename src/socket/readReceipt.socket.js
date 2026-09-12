const prisma = require("../config/database");

const registerReadReceiptEvents = (io, socket) => {

    /**
     * Mark Conversation as Read
     */
    socket.on("conversation_read", async ({ conversationId }) => {
        try {

            const participant =
                await prisma.conversationParticipant.findFirst({
                    where: {
                        conversationId,
                        userId: socket.user.id,
                    },
                });

            if (!participant) {
                return socket.emit("error", {
                    message: "You are not a participant of this conversation.",
                });
            }

            const lastReadAt = new Date();

            await prisma.conversationParticipant.update({
                where: {
                    id: participant.id,
                },
                data: {
                    lastReadAt,
                },
            });

            socket.to(conversationId).emit(
                "conversation_read",
                {
                    conversationId,
                    user: {
                        id: socket.user.id,
                        name: socket.user.name,
                    },
                    lastReadAt,
                }
            );

        } catch (error) {
            socket.emit("error", {
                message: error.message,
            });
        }
    });

};

module.exports = registerReadReceiptEvents;