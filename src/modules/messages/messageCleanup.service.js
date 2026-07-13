const prisma = require("../../config/database");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");

const cleanupExpiredMessages = async () => {
    try {
        console.log("🧹 Running expired messages cleanup task...");

        // 1. Find all messages that have expired and are not starred
        const expiredMessages = await prisma.message.findMany({
            where: {
                expiresAt: {
                    lt: new Date(),
                },
                isStarred: false,
            },
            include: {
                messageAttachments: true,
            },
        });

        if (expiredMessages.length === 0) {
            console.log("🧹 No expired messages found.");
            return;
        }

        console.log(`🧹 Found ${expiredMessages.length} expired messages to delete.`);

        // 2. Loop through messages and delete physical attachment files from disk
        for (const message of expiredMessages) {
            for (const attachment of message.messageAttachments) {
                try {
                    // Extract relative path and build absolute path
                    // If fileUrl is /uploads/attachments/filename, the local path is:
                    // backend/uploads/attachments/filename
                    if (attachment.fileUrl.startsWith("/uploads/")) {
                        const relativePath = attachment.fileUrl.substring(1); // e.g. "uploads/attachments/..."
                        const absolutePath = path.join(__dirname, "../../../", relativePath);
                        
                        if (fs.existsSync(absolutePath)) {
                            fs.unlinkSync(absolutePath);
                            console.log(`🧹 Deleted physical file: ${absolutePath}`);
                        }
                    }
                } catch (fileError) {
                    console.error(`🧹 Error deleting file ${attachment.fileUrl}:`, fileError);
                }
            }
        }

        // 3. Delete messages from database (cascade deletes will delete MessageAttachment entries)
        const expiredMessageIds = expiredMessages.map((m) => m.id);
        const deleteResult = await prisma.message.deleteMany({
            where: {
                id: {
                    in: expiredMessageIds,
                },
            },
        });

        console.log(`🧹 Successfully cleaned up ${deleteResult.count} expired messages from database.`);
    } catch (error) {
        console.error("❌ Error running expired messages cleanup:", error);
    }
};

const initMessageCleanupCron = () => {
    // Schedule to run every day at midnight
    cron.schedule("0 0 * * *", async () => {
        await cleanupExpiredMessages();
    });
    console.log("🕒 Message Cleanup Cron Job Scheduled (Daily at Midnight).");
    
    // Run cleanup on server startup once in development to verify it works
    if (process.env.NODE_ENV === "development" || !process.env.NODE_ENV) {
        console.log("🕒 Running startup check for expired messages cleanup...");
        cleanupExpiredMessages();
    }
};

module.exports = {
    cleanupExpiredMessages,
    initMessageCleanupCron,
};
