const prisma = require("../src/config/database");

async function findConflictKc() {
  console.log("=== Searching for High Mastery KCs with Active OPEN Misconceptions ===");

  const masteries = await prisma.conceptMastery.findMany({
    where: {
      masteryScore: { gte: 0.80 },
    },
    include: {
      student: {
        include: { user: true },
      },
    },
  });

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
        studentId: cm.studentId,
        concept: { in: targetConcepts },
        status: "OPEN",
      },
    });

    if (openGaps.length > 0) {
      console.log("FOUND CONFLICT MATCH:", {
        kc: cm.concept,
        studentId: cm.studentId,
        userEmail: cm.student?.user?.email,
        masteryProbability: cm.masteryScore,
        confidence: cm.confidenceLevel,
        openGap: openGaps[0],
      });
    }
  }

  await prisma.$disconnect();
}

findConflictKc().catch((err) => {
  console.error("Search error:", err);
  prisma.$disconnect();
  process.exit(1);
});
