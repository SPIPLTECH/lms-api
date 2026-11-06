/**
 * Cleans legacy hardcoded mock Education Details that an earlier version of
 * DesktopEditProfileView.jsx pre-populated and persisted to StudentProfile
 * whenever a student saved Personal Information before commit 02f1748.
 *
 * Also normalizes empty-string ("") User.phoneNumber / User.address values to
 * NULL so User.phoneNumber @unique never collides on empty strings.
 *
 * Safe & idempotent: only clears StudentProfile rows matching the exact legacy
 * mock bundle signature (collegeName = "Dr. Babasaheb Ambedkar Technological University"
 * AND guardianName starting with "Manohar Tiwari").
 */
require("dotenv").config();
const prisma = require("../src/config/database");

const MOCK_COLLEGE = "Dr. Babasaheb Ambedkar Technological University";
const MOCK_GUARDIAN_PREFIX = "Manohar Tiwari";
const MOCK_EDUCATION = "B.Tech in Artificial Intelligence & ML";
const MOCK_DOB_ISO = "2001-06-28";

async function main() {
  const pollutedProfiles = await prisma.studentProfile.findMany({
    where: {
      collegeName: MOCK_COLLEGE,
      guardianName: { startsWith: MOCK_GUARDIAN_PREFIX },
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  });

  console.log(`Found ${pollutedProfiles.length} student profile(s) with persisted mock education data.`);

  for (const profile of pollutedProfiles) {
    const dobIso = profile.dateOfBirth
      ? new Date(profile.dateOfBirth).toISOString().split("T")[0]
      : null;

    const updateData = {
      collegeName: null,
      guardianName: null,
      graduationYear: null,
      ...(profile.education === MOCK_EDUCATION ? { education: null } : {}),
      ...(dobIso === MOCK_DOB_ISO ? { dateOfBirth: null } : {}),
      ...(dobIso === MOCK_DOB_ISO && profile.gender === "Male" ? { gender: null } : {}),
    };

    await prisma.studentProfile.update({
      where: { id: profile.id },
      data: updateData,
    });

    console.log(
      `Cleared mock education details for ${profile.user?.name} (${profile.user?.email})`
    );
  }

  const emptyPhoneResult = await prisma.user.updateMany({
    where: { phoneNumber: "" },
    data: { phoneNumber: null },
  });
  const emptyAddressResult = await prisma.user.updateMany({
    where: { address: "" },
    data: { address: null },
  });

  if (emptyPhoneResult.count > 0 || emptyAddressResult.count > 0) {
    console.log(
      `Normalized empty User fields to null: phoneNumber=${emptyPhoneResult.count}, address=${emptyAddressResult.count}`
    );
  }
}

main()
  .catch((err) => {
    console.error("Cleanup failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
