const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const studentId = "cmrw0k5wa0002feg4zilzoxdl";
  const kc = "phase6_tier1_manual_test_kc";

  const mastery = await prisma.conceptMastery.findFirst({
    where: {
      studentId,
      concept: kc
    }
  });

  const gaps = await prisma.knowledgeGap.findMany({
    where: {
      studentId,
      kc
    }
  });

  console.log("\n=== CONCEPT MASTERY ===");
  console.dir(mastery, { depth: null });

  console.log("\n=== KNOWLEDGE GAPS ===");
  console.dir(gaps, { depth: null });
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });