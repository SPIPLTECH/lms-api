const onlineUsers = new Map();

// Who is online (ids and names) is shown to admins only. It used to be
// broadcast to every connected socket, so any student could watch every
// user on the platform come and go.
const STAFF_ROOM = "presence_admins";
const isAdmin = (socket) => socket.user?.role === "ADMIN";

const registerPresenceEvents = (io, socket) => {

    if (isAdmin(socket)) socket.join(STAFF_ROOM);

    /**
     * User Connected
     */
    onlineUsers.set(socket.user.id, socket.id);

    io.to(STAFF_ROOM).emit("user_online", {
        userId: socket.user.id,
        name: socket.user.name,
    });

    /**
     * Get Online Users
     */
    socket.on("get_online_users", () => {

        if (!isAdmin(socket)) return;

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

        io.to(STAFF_ROOM).emit("user_offline", {
            userId: socket.user.id,
            name: socket.user.name,
        });

    });

};

module.exports = registerPresenceEvents;
