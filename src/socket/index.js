const { Server } = require("socket.io");
const registerTypingEvents = require("./typing.socket");
const socketAuth = require("./socketAuth");
const registerConversationEvents = require("./conversation.socket");
const registerMessageEvents = require("./message.socket");
const registerReadReceiptEvents = require("./readReceipt.socket");
const registerPresenceEvents = require("./presence.socket");
let io;

const initializeSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: ["http://localhost:3000"],
            credentials: true,
        },
    });

    // Authenticate every socket connection
    io.use(socketAuth);

    io.on("connection", (socket) => {

        console.log(
            `✅ ${socket.user.name} connected (${socket.id})`
        );

        // Join user-specific notification room
        socket.join(`user_${socket.user.id}`);

        registerConversationEvents(io, socket);

        registerMessageEvents(io, socket);

        registerTypingEvents(io, socket);

        registerReadReceiptEvents(io, socket);

        registerPresenceEvents(io, socket);
        socket.on("disconnect", () => {
            console.log(
                `❌ ${socket.user.name} disconnected (${socket.id})`
            );
        });

    });
    return io;
};

const getIO = () => {
    if (!io) {
        throw new Error("Socket.io has not been initialized.");
    }

    return io;
};

module.exports = {
    initializeSocket,
    getIO,
};