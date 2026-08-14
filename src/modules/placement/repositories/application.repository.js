const prisma = require("../../../config/database");

const findByStudent = (studentId, { status } = {}, client = prisma) =>
  client.application.findMany({ where: { studentId, status: status || undefined }, orderBy: { appliedAt: "desc" } });

const findById = (id, client = prisma) => client.application.findUnique({ where: { id } });

const findByStudentAndOpportunity = (studentId, opportunityType, opportunityId, client = prisma) =>
  client.application.findUnique({ where: { studentId_opportunityType_opportunityId: { studentId, opportunityType, opportunityId } } });

/**
 * Purely a tracking record — per the constraint that this agent must NEVER
 * auto-apply on a student's behalf, this never submits anything to a real
 * ATS/company, it's this agent's own record of "the student says they
 * applied."
 */
const create = (studentId, { opportunityType, opportunityId, driveId, notes }, client = prisma) =>
  client.application.create({
    data: { studentId, opportunityType, opportunityId, driveId: driveId || null, notes: notes || null },
  });

module.exports = { findByStudent, findById, findByStudentAndOpportunity, create };
