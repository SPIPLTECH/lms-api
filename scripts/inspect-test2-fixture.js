const prisma = require("../src/config/database");

async function inspectTest2Fixture() {
  console.log("=== Inspecting Test 2 Database Fixture Data ===");

  const targetKc = "test_kc_isolation_A_1786430291314";

  // 1. Search for ConceptMastery record for target KC across all students
  const masteries = await prisma.conceptMastery.findMany({
    where: { concept: targetKc },
    include: {
      student: {
        include: { user: true },
      },
    },
  });

  console.log(`\n1. Found ${masteries.length} ConceptMastery records for KC "${targetKc}":`);
  let studentId = null;
  for (const cm of masteries) {
    studentId = cm.studentId;
    console.log({
      id: cm.id,
      studentId: cm.studentId,
      userEmail: cm.student?.user?.email,
      concept: cm.concept,
      masteryScore: cm.masteryScore,
      confidenceLevel: cm.confidenceLevel,
      attemptsCount: cm.attemptsCount,
      recentScores: cm.recentScores,
    });
  }

  if (!studentId && masteries.length === 0) {
    console.log("No ConceptMastery record found for this KC. Checking student with email pawantiwari876756@gmail.com...");
    const user = await prisma.user.findUnique({
      where: { email: "pawantiwari876756@gmail.com" },
      include: { studentProfile: true },
    });
    if (user && user.studentProfile) {
      studentId = user.studentProfile.id;
    }
  }

  if (studentId) {
    console.log(`\n2. Querying ALL KnowledgeGap records for student ${studentId}:`);
    const gaps = await prisma.knowledgeGap.findMany({
      where: { studentId },
    });
    console.log(JSON.stringify(gaps, null, 2));

    console.log(`\n3. Querying ALL ConceptMastery records for student ${studentId}:`);
    const allMasteries = await prisma.conceptMastery.findMany({
      where: { studentId },
    });
    console.log(JSON.stringify(allMasteries, null, 2));

    console.log(`\n4. Querying ALL LearningEvent records for student ${studentId}:`);
    const events = await prisma.learningEvent.findMany({
      where: { studentId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    console.log(JSON.stringify(events, null, 2));
  }

  await prisma.$disconnect();
}

inspectTest2Fixture().catch((err) => {
  console.error("Inspection error:", err);
  prisma.$disconnect();
  process.exit(1);
});
