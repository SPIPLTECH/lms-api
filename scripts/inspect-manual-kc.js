const prisma = require("../src/config/database");

async function inspectManualKc() {
  console.log("=== Inspecting manual_kc_open_misconception state ===");

  const user = await prisma.user.findUnique({
    where: { email: "phase6_manual_student@orangetree.com" },
    include: { studentProfile: true },
  });

  const studentId = user.studentProfile.id;
  console.log(`Student Profile ID: ${studentId}`);

  const masteries = await prisma.conceptMastery.findMany({
    where: { studentId, concept: "manual_kc_open_misconception" },
  });
  console.log("\nConceptMastery for manual_kc_open_misconception:");
  console.log(JSON.stringify(masteries, null, 2));

  const gaps = await prisma.knowledgeGap.findMany({
    where: { studentId },
  });
  console.log(`\nALL KnowledgeGap records for student ${studentId} (${gaps.length} total):`);
  console.log(JSON.stringify(gaps, null, 2));

  await prisma.$disconnect();
}

inspectManualKc().catch((err) => {
  console.error("Inspection error:", err);
  prisma.$disconnect();
  process.exit(1);
});
