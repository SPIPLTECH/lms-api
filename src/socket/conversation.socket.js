const conversationService = require("../modules/conversations/conversation.service");

const registerConversationEvents = (io, socket) => {

    /**
     * Join Conversation
     */
    socket.on("join_conversation", async (conversationId) => {
        try {

            const isParticipant =
                await conversationService.isParticipant(
                    conversationId,
                    socket.user.id
                );

            if (!isParticipant) {
                return socket.emit("error", {
                    message: "You are not a participant of this conversation.",
                });
            }

            socket.join(conversationId);

            console.log(
                `${socket.user.name} joined room ${conversationId}`
            );

            socket.emit("joined_conversation", {
                conversationId,
            });

        } catch (error) {
            socket.emit("error", {
                message: error.message,
            });
        }
    });

    /**
     * Leave Conversation
     */
    socket.on("leave_conversation", (conversationId) => {

        socket.leave(conversationId);

        console.log(
            `${socket.user.name} left room ${conversationId}`
        );

        socket.emit("left_conversation", {
            conversationId,
        });

    });

};

module.exports = registerConversationEvents;