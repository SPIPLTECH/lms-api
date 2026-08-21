const messageService = require("../modules/messages/message.service");

const registerMessageEvents = (io, socket) => {
    /**
     * Send Message
     */
    socket.on("send_message", async (data) => {
        try {
            const {
                conversationId,
                content,
            } = data;

            if (!conversationId) {
                return socket.emit("error", {
                    message: "Conversation ID is required.",
                });
            }

            if (!content || !content.trim()) {
                return socket.emit("error", {
                    message: "Message content is required.",
                });
            }

            const message = await messageService.sendMessage(
                conversationId,
                socket.user.id,
                {
                    content: content.trim(),
                }
            );

            const prisma = require("../config/database");

            io.to(conversationId).emit("receive_message", message);
            io.to(conversationId).emit("message:new", message);

            const conv = await prisma.conversation.findUnique({
                where: { id: conversationId },
                include: { participants: true },
            });
            if (conv && conv.participants) {
                conv.participants.forEach((p) => {
                    io.to(`user_${p.userId}`).emit("receive_message", message);
                    io.to(`user_${p.userId}`).emit("message:new", message);
                });
            }

        } catch (error) {
            socket.emit("error", {
                message: error.message,
            });
        }
    });
};

module.exports = registerMessageEvents;