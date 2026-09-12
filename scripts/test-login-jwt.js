const jwt = require("jsonwebtoken");
const prisma = require("../src/config/database");
const authService = require("../src/modules/auth/auth.service");

async function testLoginJwt() {
  console.log("=== Testing login and JWT generation for pawantiwari876756@gmail.com ===");

  const email = "pawantiwari876756@gmail.com";
  const userInDb = await prisma.user.findUnique({
    where: { email },
    include: { studentProfile: true },
  });

  console.log("\n1. Direct DB lookup for user:", JSON.stringify(userInDb, null, 2));

  // Also check if there are multiple users with this email (or similar email)
  const allUsersWithEmail = await prisma.user.findMany({
    where: { email: { contains: "pawantiwari" } },
    include: { studentProfile: true },
  });
  console.log("\n2. All users matching 'pawantiwari':", JSON.stringify(allUsersWithEmail, null, 2));

  // Now test generateAccessToken directly with userInDb
  if (userInDb) {
    const token = jwt.sign(
      {
        id: userInDb.id,
        email: userInDb.email,
        role: userInDb.role,
      },
      process.env.JWT_ACCESS_SECRET || "access_secret",
      { expiresIn: "1d" }
    );

    const decoded = jwt.decode(token);
    console.log("\n3. Decoded JWT payload from userInDb:", decoded);
    console.log("Does decoded.id === userInDb.id?", decoded.id === userInDb.id);
  }

  await prisma.$disconnect();
}

testLoginJwt().catch((err) => {
  console.error("Error:", err);
  prisma.$disconnect();
  process.exit(1);
});
