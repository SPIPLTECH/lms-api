const prisma = require("../src/config/database");

async function findIsolatedBelowThresholdKc() {
  console.log("=== Searching for Isolated Below-Threshold KCs ===");

  const studentId = "cmrw0k5wa0002feg4zilzoxdl";

  const masteries = await prisma.conceptMastery.findMany({
    where: { studentId },
  });

  console.log(`Checking ${masteries.length} KCs for student ${studentId}:\n`);

  for (const cm of masteries) {
    const kcRecentScores = Array.isArray(cm.recentScores) ? cm.recentScores : [];
    const linkedHypotheses = Array.from(
      new Set(
        kcRecentScores
          .map((s) => s && s.misconceptionHypothesis)
          .filter((h) => typeof h === "string" && h.trim().length > 0)
      )
    );
    const targetConcepts = Array.from(new Set([cm.concept, ...linkedHypotheses]));

    const openGaps = await prisma.knowledgeGap.findMany({
      where: {
        studentId,
        concept: { in: targetConcepts },
        status: "OPEN",
      },
    });

    const closedGaps = await prisma.knowledgeGap.findMany({
      where: {
        studentId,
        concept: { in: targetConcepts },
        status: "CLOSED",
      },
    });

    if (openGaps.length === 0 && cm.masteryScore <= 0.40) {
      console.log("MATCH FOUND:", {
        kc: cm.concept,
        masteryScore: cm.masteryScore,
        confidenceLevel: cm.confidenceLevel,
        attemptsCount: cm.attemptsCount,
        linkedHypotheses,
        closedGapsCount: closedGaps.length,
        closedGaps: closedGaps.map(g => ({ concept: g.concept, severity: g.severity, status: g.status })),
        openGapsCount: openGaps.length,
      });
    }
  }

  await prisma.$disconnect();
}

findIsolatedBelowThresholdKc().catch((err) => {
  console.error("Search error:", err);
  prisma.$disconnect();
  process.exit(1);
});
