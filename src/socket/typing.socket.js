const prisma = require("../config/database");

const registerTypingEvents = (io, socket) => {

    /**
     * Typing Started
     */
    socket.on("typing_start", async ({ conversationId }) => {
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

            socket.to(conversationId).emit("typing_start", {
                conversationId,
                user: {
                    id: socket.user.id,
                    name: socket.user.name,
                },
            });

        } catch (error) {
            socket.emit("error", {
                message: error.message,
            });
        }
    });

    /**
     * Typing Stopped
     */
    socket.on("typing_stop", async ({ conversationId }) => {
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

            socket.to(conversationId).emit("typing_stop", {
                conversationId,
                user: {
                    id: socket.user.id,
                    name: socket.user.name,
                },
            });

        } catch (error) {
            socket.emit("error", {
                message: error.message,
            });
        }
    });

};

module.exports = registerTypingEvents;