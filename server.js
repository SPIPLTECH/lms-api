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

// The 12 AI agent modules' bootstrap() calls (student-state, assessment,
// recommendation, motivation, teacher-insights, analytics, career,
// learning-path, placement, admin-intelligence, mentor) were removed from
// here — full backup + restoration package at backup/ai-agents/. The AI
// Student Entry Phase feature (not one of the 12) has no bootstrap/
// scheduler of its own — it's request-driven only.
server.listen(PORT, () => {
    console.log(
        `🚀 Server running on port ${PORT}`
    );
});