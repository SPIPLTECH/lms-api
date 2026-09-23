const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

require("dotenv").config();

const http = require("http");
const os = require("os");

const app = require("./src/app");
const {
    initializeSocket,
} = require("./src/socket");


const PORT = process.env.PORT || 5000;

// Binding to 0.0.0.0 makes the API reachable from other devices on the same
// Wi-Fi, not just from this machine. Node already defaults to every interface,
// but saying so explicitly keeps the intent visible and lets HOST pin it back
// to 127.0.0.1 when the API should stay private to this PC.
//
// This exposes the API only. PostgreSQL is untouched: Prisma still connects
// over DATABASE_URL to localhost:5432, so the database stays reachable from
// this process alone and never from the network.
const HOST = process.env.HOST || "0.0.0.0";

/** IPv4 addresses this machine can be reached on from the LAN. */
const lanAddresses = () =>
    Object.values(os.networkInterfaces())
        .flat()
        .filter((iface) => iface && iface.family === "IPv4" && !iface.internal)
        .map((iface) => iface.address);

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
server.listen(PORT, HOST, () => {
    console.log(
        `🚀 Server running on port ${PORT}`
    );
    console.log(`   Local:   http://localhost:${PORT}`);

    if (HOST === "0.0.0.0") {
        const addresses = lanAddresses();
        if (addresses.length === 0) {
            console.log("   Network: no LAN interface detected");
        } else {
            addresses.forEach((address) => {
                console.log(`   Network: http://${address}:${PORT}`);
            });
            console.log(
                `   Open the LMS from another device on this Wi-Fi at http://${addresses[0]}:3000`
            );
        }
    }
});