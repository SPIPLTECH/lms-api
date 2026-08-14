const prisma = require("../../../config/database");

const findByStudent = (studentId, client = prisma) => client.placementProfile.findUnique({ where: { studentId } });

/** Live current row, version-bumped in place — same pattern as CareerProfile. */
const upsert = (studentId, fields, now = new Date(), client = prisma) =>
  client.placementProfile.upsert({
    where: { studentId },
    create: { studentId, ...fields, version: 1, lastCalculatedAt: now },
    update: { ...fields, version: { increment: 1 }, lastCalculatedAt: now },
  });

module.exports = { findByStudent, upsert };
