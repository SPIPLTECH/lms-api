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

            const message =
                await messageService.sendMessage(
                    conversationId,
                    socket.user.id,
                    {
                        content,
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