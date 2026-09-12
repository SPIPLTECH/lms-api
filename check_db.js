require("dotenv").config();
const prisma = require("./src/config/database");

async function main() {
  const users = await prisma.user.findFirst();
  console.log("CONNECTED SUCCESS! Found user:", users?.email || "No users");
}
main().catch(err => console.error("CONNECTION ERROR:", err.message)).finally(() => prisma.$disconnect());

