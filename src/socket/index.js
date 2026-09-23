const { Server } = require("socket.io");
const registerTypingEvents = require("./typing.socket");
const socketAuth = require("./socketAuth");
const registerConversationEvents = require("./conversation.socket");
const registerMessageEvents = require("./message.socket");
const registerReadReceiptEvents = require("./readReceipt.socket");
const registerPresenceEvents = require("./presence.socket");
const { corsOriginDelegate } = require("../config/allowedOrigins");
let io;

const initializeSocket = (server) => {
    // Origin policy lives in src/config/allowedOrigins.js, shared with the
    // Express CORS layer in src/app.js. It still honours FRONTEND_URL (a single
    // origin or a comma-separated list, so preview/staging deployments need no
    // code change) and the same localhost/vercel defaults this file used to
    // hold inline. What it adds is LAN origins: when the app is served to
    // another device on the same Wi-Fi the handshake Origin is
    // http://<private-LAN-IP>:3000, which no static list can predict, and
    // rejecting it here is what used to leave chat, presence and notifications
    // dead on every device except the host PC.
    io = new Server(server, {
        cors: {
            origin: corsOriginDelegate,
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