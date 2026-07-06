const onlineUsers = new Map();

const registerPresenceEvents = (io, socket) => {

    /**
     * User Connected
     */
    onlineUsers.set(socket.user.id, socket.id);

    io.emit("user_online", {
        userId: socket.user.id,
        name: socket.user.name,
    });

    /**
     * Get Online Users
     */
    socket.on("get_online_users", () => {

        socket.emit(
            "online_users",
            Array.from(onlineUsers.keys())
        );

    });

    /**
     * User Disconnected
     */
    socket.on("disconnect", () => {

        onlineUsers.delete(socket.user.id);

        io.emit("user_offline", {
            userId: socket.user.id,
            name: socket.user.name,
        });

    });

};

module.exports = registerPresenceEvents;