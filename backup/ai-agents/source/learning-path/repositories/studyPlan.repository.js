const prisma = require("../../../config/database");

/** Most recently generated plan of this type, regardless of exact periodStart — what GET /daily-plan and /weekly-plan actually want to read. */
const findLatestByStudentAndType = (studentId, planType, client = prisma) =>
  client.studyPlan.findFirst({ where: { studentId, planType }, orderBy: { periodStart: "desc" } });

/** One current row per (student, planType, period) — overwritten in place if the same period is regenerated (e.g. two recomputes on the same day). */
const upsert = (studentId, planType, periodStart, fields, client = prisma) =>
  client.studyPlan.upsert({
    where: { studentId_planType_periodStart: { studentId, planType, periodStart } },
    create: { studentId, planType, periodStart, ...fields, version: 1 },
    update: { ...fields, version: { increment: 1 }, generatedAt: new Date() },
  });

module.exports = { findLatestByStudentAndType, upsert };
