const prisma = require("../../../config/database");
const { JOB_MATCH_STATUS } = require("../constants");

const findActiveByStudent = (studentId, { opportunityType } = {}, client = prisma) =>
  client.jobMatch.findMany({
    where: { studentId, status: JOB_MATCH_STATUS.ACTIVE, opportunityType: opportunityType || undefined },
    orderBy: [{ matchPercent: "desc" }],
  });

const findAllActiveDedupeKeys = (studentId, client = prisma) =>
  client.jobMatch.findMany({ where: { studentId, status: JOB_MATCH_STATUS.ACTIVE }, select: { id: true, dedupeKey: true } });

const upsertCandidate = (studentId, candidate, client = prisma) =>
  client.jobMatch.upsert({
    where: { studentId_dedupeKey: { studentId, dedupeKey: candidate.dedupeKey } },
    create: {
      studentId,
      opportunityType: candidate.opportunityType,
      opportunityId: candidate.opportunityId,
      dedupeKey: candidate.dedupeKey,
      matchPercent: candidate.matchPercent,
      missingSkills: candidate.missingSkills,
      priority: candidate.priority,
      status: JOB_MATCH_STATUS.ACTIVE,
      reason: candidate.reason,
      version: 1,
    },
    update: {
      matchPercent: candidate.matchPercent,
      missingSkills: candidate.missingSkills,
      priority: candidate.priority,
      status: JOB_MATCH_STATUS.ACTIVE,
      reason: candidate.reason,
      version: { increment: 1 },
      generatedAt: new Date(),
    },
  });

const updateStatus = (id, status, client = prisma) => client.jobMatch.update({ where: { id }, data: { status } });

module.exports = { findActiveByStudent, findAllActiveDedupeKeys, upsertCandidate, updateStatus };
