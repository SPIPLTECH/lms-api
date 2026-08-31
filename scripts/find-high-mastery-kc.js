const prisma = require("../src/config/database");

async function findHighMasteryKc() {
  console.log("=== Searching for High Mastery KCs across all Student Profiles ===");

  const masteries = await prisma.conceptMastery.findMany({
    where: {
      masteryScore: { gte: 0.85 },
      status: "MASTERED",
    },
    include: {
      student: {
        include: { user: true },
      },
    },
  });

  console.log(`Found ${masteries.length} ConceptMastery records matching masteryScore >= 0.85 and status == 'MASTERED':\n`);

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

    console.log({
      kc: cm.concept,
      studentId: cm.studentId,
      userEmail: cm.student?.user?.email,
      masteryProbability: cm.masteryScore,
      confidence: cm.confidenceLevel,
      status: cm.status,
      attemptsCount: cm.attemptsCount,
      linkedHypotheses,
      openGapsCount: openGaps.length,
      openGaps: openGaps.map(g => ({ concept: g.concept, severity: g.severity, status: g.status })),
      isHighConfidence: cm.confidenceLevel >= 0.50,
    });
  }

  await prisma.$disconnect();
}

findHighMasteryKc().catch((err) => {
  console.error("Search error:", err);
  prisma.$disconnect();
  process.exit(1);
});
