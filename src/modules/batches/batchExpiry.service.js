const prisma = require("../../config/database");
const cron = require("node-cron");

const removeStudentsFromExpiredBatches = async () => {
  try {
    console.log("🧹 Running expired batches student-removal task...");

    const now = new Date();
    const expiredBatches = await prisma.batch.findMany({
      where: {
        availableUntil: { lt: now },
        students: { some: {} },
      },
      select: { id: true, name: true, _count: { select: { students: true } } },
    });

    if (expiredBatches.length === 0) {
      console.log("🧹 No expired batches with students found.");
      return;
    }

    for (const batch of expiredBatches) {
      await prisma.batch.update({
        where: { id: batch.id },
        data: { students: { set: [] } },
      });
      console.log(
        `🧹 Removed ${batch._count.students} student(s) from expired batch "${batch.name}" (${batch.id}).`
      );
    }

    console.log(`🧹 Cleared students from ${expiredBatches.length} expired batch(es).`);
  } catch (error) {
    console.error("❌ Error removing students from expired batches:", error);
  }
};

const initBatchExpiryCron = () => {
  // Same cadence as the message cleanup cron: daily at midnight.
  cron.schedule("0 0 * * *", async () => {
    await removeStudentsFromExpiredBatches();
  });
  console.log("🕒 Batch Expiry Cleanup Cron Job Scheduled (Daily at Midnight).");

  if (process.env.NODE_ENV === "development" || !process.env.NODE_ENV) {
    console.log("🕒 Running startup check for expired batch cleanup...");
    removeStudentsFromExpiredBatches();
  }
};

module.exports = {
  removeStudentsFromExpiredBatches,
  initBatchExpiryCron,
};
