const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const msg = await prisma.message.findFirst({
      select: {
        id: true,
        isStarred: true,
        expiresAt: true
      }
    });
    console.log("Success! Columns exist. First message details:", msg);
  } catch (err) {
    console.error("Columns do not exist in the database:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
