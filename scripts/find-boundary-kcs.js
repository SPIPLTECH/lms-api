const prisma = require("../src/config/database");

async function findBoundaryKcs() {
  console.log("=== Searching for Boundary KCs (Below 0.35 vs At/Above 0.35) ===");

  const gaps = await prisma.knowledgeGap.findMany({
    orderBy: { severity: "asc" },
  });

  console.log(`Found ${gaps.length} total KnowledgeGap records in DB:\n`);

  for (const g of gaps) {
    console.log({
      gapId: g.id,
      studentId: g.studentId,
      concept: g.concept,
      severity: g.severity,
      status: g.status,
      isAtOrAboveThreshold: g.severity >= 0.35,
    });
  }

  await prisma.$disconnect();
}

findBoundaryKcs().catch((err) => {
  console.error("Search error:", err);
  prisma.$disconnect();
  process.exit(1);
});
