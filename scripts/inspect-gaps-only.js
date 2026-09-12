const prisma = require("../src/config/database");

async function inspectGaps() {
  const studentId = "cmrw0k5wa0002feg4zilzoxdl";
  const gaps = await prisma.knowledgeGap.findMany({
    where: { studentId },
  });

  console.log(`KnowledgeGap records for student ${studentId} (${gaps.length} total):`);
  console.log(JSON.stringify(gaps, null, 2));

  await prisma.$disconnect();
}

inspectGaps().catch((err) => {
  console.error("Inspection error:", err);
  prisma.$disconnect();
  process.exit(1);
});
