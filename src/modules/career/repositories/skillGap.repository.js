const prisma = require("../../../config/database");
const { SKILL_GAP_STATUS } = require("../constants");

const findOpenByStudentAndRole = (studentId, targetRoleId, client = prisma) =>
  client.skillGap.findMany({
    where: { studentId, targetRoleId, status: SKILL_GAP_STATUS.OPEN },
    orderBy: { gapSize: "desc" },
  });

/** Every OPEN gap's (id, skillName) for one (student, role) pair — used to detect which gaps have closed on recompute. */
const findAllOpenKeys = (studentId, targetRoleId, client = prisma) =>
  client.skillGap.findMany({
    where: { studentId, targetRoleId, status: SKILL_GAP_STATUS.OPEN },
    select: { id: true, skillName: true },
  });

const upsertCandidate = (studentId, targetRoleId, gap, client = prisma) =>
  client.skillGap.upsert({
    where: { studentId_targetRoleId_skillName: { studentId, targetRoleId, skillName: gap.skillName } },
    create: {
      studentId,
      targetRoleId,
      skillName: gap.skillName,
      requiredLevel: gap.requiredLevel,
      currentLevel: gap.currentLevel,
      gapSize: gap.gapSize,
      severity: gap.severity,
      status: SKILL_GAP_STATUS.OPEN,
      version: 1,
    },
    update: {
      requiredLevel: gap.requiredLevel,
      currentLevel: gap.currentLevel,
      gapSize: gap.gapSize,
      severity: gap.severity,
      status: SKILL_GAP_STATUS.OPEN,
      closedAt: null,
      version: { increment: 1 },
    },
  });

const closeById = (id, now = new Date(), client = prisma) =>
  client.skillGap.update({ where: { id }, data: { status: SKILL_GAP_STATUS.CLOSED, closedAt: now } });

module.exports = { findOpenByStudentAndRole, findAllOpenKeys, upsertCandidate, closeById };
