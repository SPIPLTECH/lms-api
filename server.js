require("dotenv").config();

const http = require("http");

const app = require("./src/app");
const {
    initializeSocket,
} = require("./src/socket");


const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Initialize Socket.io
initializeSocket(server);

// Initialize Message Cleanup Cron Job
const { initMessageCleanupCron } = require("./src/modules/messages/messageCleanup.service");
initMessageCleanupCron();

server.listen(PORT, () => {
    console.log(
        `🚀 Server running on port ${PORT}`
    );
});