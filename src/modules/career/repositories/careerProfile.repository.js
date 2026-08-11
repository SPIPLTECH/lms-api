const prisma = require("../../../config/database");

const findByStudent = (studentId, client = prisma) =>
  client.careerProfile.findUnique({ where: { studentId }, include: { primaryTargetRole: true } });

/** Live current row, version-bumped in place — same pattern as CourseHealth/StudentLearningState. */
const upsert = (studentId, fields, now = new Date(), client = prisma) =>
  client.careerProfile.upsert({
    where: { studentId },
    create: { studentId, ...fields, version: 1, lastCalculatedAt: now },
    update: { ...fields, version: { increment: 1 }, lastCalculatedAt: now },
  });

module.exports = { findByStudent, upsert };
