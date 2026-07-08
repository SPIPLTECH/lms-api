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

            io.to(conversationId).emit(
                "receive_message",
                message
            );

        } catch (error) {
            socket.emit("error", {
                message: error.message,
            });
        }
    });
};

module.exports = registerMessageEvents;