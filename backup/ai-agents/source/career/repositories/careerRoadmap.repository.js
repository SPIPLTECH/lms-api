const prisma = require("../../../config/database");

const findByStudent = (studentId, client = prisma) => client.careerRoadmap.findMany({ where: { studentId } });

const findByStudentAndHorizon = (studentId, horizon, client = prisma) =>
  client.careerRoadmap.findUnique({ where: { studentId_horizon: { studentId, horizon } } });

/** One current row per (student, horizon) — regenerated whole on every recompute, version-bumped in place. */
const upsertHorizon = (studentId, horizon, { targetRoleId, milestones }, client = prisma) =>
  client.careerRoadmap.upsert({
    where: { studentId_horizon: { studentId, horizon } },
    create: { studentId, horizon, targetRoleId: targetRoleId || null, milestones, version: 1 },
    update: { targetRoleId: targetRoleId || null, milestones, version: { increment: 1 }, generatedAt: new Date() },
  });

module.exports = { findByStudent, findByStudentAndHorizon, upsertHorizon };
