const prisma = require("../src/config/database");

async function findGap() {
  console.log("=== Searching for KnowledgeGap with syntax_error_pattern ===");

  const gaps = await prisma.knowledgeGap.findMany({
    where: {
      concept: "syntax_error_pattern",
      status: "OPEN",
    },
    include: {
      student: {
        include: { user: true },
      },
    },
  });

  console.log(`Found ${gaps.length} matching KnowledgeGap records:`);
  for (const gap of gaps) {
    console.log({
      gapId: gap.id,
      concept: gap.concept,
      severity: gap.severity,
      status: gap.status,
      studentId: gap.studentId,
      userEmail: gap.student?.user?.email,
      userId: gap.student?.user?.id,
    });
  }

  // Also search for any ConceptMastery record for test_kc_no_hypothesis_1786430290863
  const masteries = await prisma.conceptMastery.findMany({
    where: {
      concept: "test_kc_no_hypothesis_1786430290863",
    },
    include: {
      student: {
        include: { user: true },
      },
    },
  });

  console.log(`\nFound ${masteries.length} ConceptMastery records for test_kc_no_hypothesis_1786430290863:`);
  for (const cm of masteries) {
    console.log({
      masteryId: cm.id,
      concept: cm.concept,
      masteryScore: cm.masteryScore,
      studentId: cm.studentId,
      userEmail: cm.student?.user?.email,
    });
  }

  await prisma.$disconnect();
}

findGap().catch((err) => {
  console.error("Search error:", err);
  prisma.$disconnect();
  process.exit(1);
});
