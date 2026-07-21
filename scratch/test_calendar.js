const prisma = require("../src/config/database");

async function main() {
  try {
    console.log("Attempting to query calendarEvent...");
    const events = await prisma.calendarEvent.findMany();
    console.log("Successfully fetched events:", events.length);
  } catch (error) {
    console.error("Database query failed with error:");
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
