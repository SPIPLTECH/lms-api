const prisma = require("../../../config/database");

const findAllByStudent = (studentId, client = prisma) => client.skillAssessment.findMany({ where: { studentId } });

/** Upserts this cycle's full skill snapshot — one row per (student, skillName), version-bumped in place. */
const upsertMany = async (studentId, skills, now = new Date(), client = prisma) => {
  for (const skill of skills) {
    await client.skillAssessment.upsert({
      where: { studentId_skillName: { studentId, skillName: skill.skillName } },
      create: {
        studentId,
        skillName: skill.skillName,
        proficiency: skill.proficiency,
        status: skill.status,
        lastAssessedAt: now,
        version: 1,
      },
      update: {
        proficiency: skill.proficiency,
        status: skill.status,
        lastAssessedAt: now,
        version: { increment: 1 },
      },
    });
  }
};

module.exports = { findAllByStudent, upsertMany };
