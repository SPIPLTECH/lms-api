const prisma = require("../src/config/database");

async function inspectDatabase() {
  const EMAIL = "phase6_manual_student@orangetree.com";

  console.log("=== Database Inspection ===");

  const user = await prisma.user.findUnique({
    where: { email: EMAIL },
    include: { studentProfile: true },
  });

  if (!user || !user.studentProfile) {
    console.log(`User/StudentProfile not found for email: ${EMAIL}`);
    await prisma.$disconnect();
    return;
  }

  const studentId = user.studentProfile.id;
  console.log(`Authenticated User ID: ${user.id}`);
  console.log(`Authenticated Student Profile ID: ${studentId}`);

  // Fetch all ConceptMastery records for this student
  const masteries = await prisma.conceptMastery.findMany({
    where: { studentId },
  });
  console.log("\n--- ConceptMastery Records ---");
  console.log(JSON.stringify(masteries, null, 2));

  // Fetch all KnowledgeGap records for this student
  const gaps = await prisma.knowledgeGap.findMany({
    where: { studentId },
  });
  console.log("\n--- KnowledgeGap / Misconception Records ---");
  console.log(JSON.stringify(gaps, null, 2));

  await prisma.$disconnect();
}

inspectDatabase().catch((err) => {
  console.error("Inspection error:", err);
  prisma.$disconnect();
  process.exit(1);
});
