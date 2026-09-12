const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const prisma = require("../src/config/database");

async function seedPhase6ManualFixture() {
  const EMAIL = "phase6_manual_student@orangetree.com";
  const PASSWORD = "Password123!";

  console.log("=== Phase 6 Manual Test Fixture Setup ===");

  // 1. Check or create test user
  let user = await prisma.user.findUnique({ where: { email: EMAIL } });

  const hashedPassword = await bcrypt.hash(PASSWORD, 10);

  if (!user) {
    user = await prisma.user.create({
      data: {
        name: "Phase 6 Manual Test Student",
        email: EMAIL,
        password: hashedPassword,
        role: "STUDENT",
        isVerified: true,
      },
    });
    console.log(`Created new isolated student user: ${user.id}`);
  } else {
    // Update password & verify status
    user = await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, isVerified: true },
    });
    console.log(`Found existing student user: ${user.id}`);
  }

  // 2. Check or create student profile
  let profile = await prisma.studentProfile.findUnique({ where: { userId: user.id } });
  if (!profile) {
    profile = await prisma.studentProfile.create({
      data: {
        userId: user.id,
        education: "Computer Science",
      },
    });
    console.log(`Created new student profile: ${profile.id}`);
  } else {
    console.log(`Found existing student profile: ${profile.id}`);
  }

  // 3. Clear all prior learner model data for THIS isolated test student
  const deletedMastery = await prisma.conceptMastery.deleteMany({ where: { studentId: profile.id } });
  const deletedGaps = await prisma.knowledgeGap.deleteMany({ where: { studentId: profile.id } });
  const deletedEvents = await prisma.learningEvent.deleteMany({ where: { studentId: profile.id } });
  const deletedState = await prisma.studentState.deleteMany({ where: { studentId: profile.id } });

  console.log(`Cleared previous test state for student ${profile.id}:`);
  console.log(`  - ConceptMastery records deleted: ${deletedMastery.count}`);
  console.log(`  - KnowledgeGap records deleted: ${deletedGaps.count}`);
  console.log(`  - LearningEvent records deleted: ${deletedEvents.count}`);
  console.log(`  - StudentState records deleted: ${deletedState.count}`);

  // 4. Generate JWT access token
  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_ACCESS_SECRET || "fallback_secret",
    { expiresIn: "7d" }
  );

  console.log("\n==================================================");
  console.log("PHASE 6 MANUAL TEST FIXTURE CREATED SUCCESSFULLY");
  console.log("==================================================");
  console.log(`Email:               ${user.email}`);
  console.log(`Password:            ${PASSWORD}`);
  console.log(`User ID:             ${user.id}`);
  console.log(`Student Profile ID:  ${profile.id}`);
  console.log("\nJWT ACCESS TOKEN (use in Authorization: Bearer <token>):");
  console.log(token);
  console.log("==================================================\n");

  await prisma.$disconnect();
}

seedPhase6ManualFixture().catch((err) => {
  console.error("Fixture setup failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
