const prisma = require("../src/config/database");

async function findGuidedPracticeKc() {
  console.log("=== Searching DB for GUIDED_PRACTICE KC Matches ===");

  const students = [
    "cmrw0k5wa0002feg4zilzoxdl", // pawantiwari876756@gmail.com
    "cmsoaxayx0002uemkvw8zm8au", // phase6_manual_student@orangetree.com
  ];

  for (const studentId of students) {
    const masteries = await prisma.conceptMastery.findMany({
      where: {
        studentId,
        masteryScore: { gte: 0.40, lt: 0.85 },
      },
      include: {
        student: { include: { user: true } },
      },
    });

    console.log(`Found ${masteries.length} candidates for student ${studentId}:`);

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

      console.log({
        kc: cm.concept,
        studentId: cm.studentId,
        userEmail: cm.student?.user?.email,
        masteryProbability: cm.masteryScore,
        confidence: cm.confidenceLevel,
        status: cm.status,
        attemptsCount: cm.attemptsCount,
        openGapsCount: openGaps.length,
        openGaps: openGaps.map(g => ({ concept: g.concept, severity: g.severity })),
      });
    }
  }

  await prisma.$disconnect();
}

findGuidedPracticeKc().catch((err) => {
  console.error("Search error:", err);
  prisma.$disconnect();
  process.exit(1);
});
