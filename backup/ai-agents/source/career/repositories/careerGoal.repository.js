const prisma = require("../../../config/database");
const { CAREER_GOAL_STATUS } = require("../constants");

const findActiveByStudent = (studentId, client = prisma) =>
  client.careerGoal.findFirst({
    where: { studentId, status: CAREER_GOAL_STATUS.ACTIVE },
    include: { targetRole: true },
    orderBy: { createdAt: "desc" },
  });

const findByStudent = (studentId, client = prisma) =>
  client.careerGoal.findMany({ where: { studentId }, include: { targetRole: true }, orderBy: { createdAt: "desc" } });

/** Only one ACTIVE goal per student — abandons whatever's currently active before the caller creates the new one. */
const abandonActive = (studentId, client = prisma) =>
  client.careerGoal.updateMany({
    where: { studentId, status: CAREER_GOAL_STATUS.ACTIVE },
    data: { status: CAREER_GOAL_STATUS.ABANDONED },
  });

const create = (studentId, { targetRoleId, targetDate, notes }, client = prisma) =>
  client.careerGoal.create({
    data: { studentId, targetRoleId, targetDate: targetDate || null, notes: notes || null, status: CAREER_GOAL_STATUS.ACTIVE },
    include: { targetRole: true },
  });

module.exports = { findActiveByStudent, findByStudent, abandonActive, create };
