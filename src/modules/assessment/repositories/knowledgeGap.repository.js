const prisma = require("../../../config/database");
const { GAP_STATUS } = require("../constants");

const findOpenByStudentAndConcept = (studentId, concept, client = prisma) => {
  return client.knowledgeGap.findFirst({
    where: { studentId, concept, status: GAP_STATUS.OPEN },
  });
};

/** Opens a new gap, or bumps severity on the already-open one for this concept — never duplicates. */
const ensureOpen = async (studentId, concept, severity, client = prisma) => {
  const existing = await findOpenByStudentAndConcept(studentId, concept, client);

  if (existing) {
    return client.knowledgeGap.update({ where: { id: existing.id }, data: { severity } });
  }

  return client.knowledgeGap.create({ data: { studentId, concept, severity, status: GAP_STATUS.OPEN } });
};

/** Closes the open gap for this concept, if one exists. No-op otherwise. */
const ensureClosed = async (studentId, concept, closedAt, client = prisma) => {
  const existing = await findOpenByStudentAndConcept(studentId, concept, client);
  if (!existing) return null;

  return client.knowledgeGap.update({
    where: { id: existing.id },
    data: { status: GAP_STATUS.CLOSED, closedAt },
  });
};

const findAllOpenByStudent = (studentId, client = prisma) => {
  return client.knowledgeGap.findMany({
    where: { studentId, status: GAP_STATUS.OPEN },
    orderBy: { severity: "desc" },
  });
};

/** Batch read for cross-agent consumers aggregating many students' open gaps in one query (e.g. Teacher Insight's class-wide concept analysis). */
const findAllOpenByStudents = (studentIds, client = prisma) => {
  return client.knowledgeGap.findMany({ where: { studentId: { in: studentIds }, status: GAP_STATUS.OPEN } });
};

const findHistoryByStudent = (studentId, { skip, take } = {}, client = prisma) => {
  return client.knowledgeGap.findMany({
    where: { studentId },
    orderBy: { detectedAt: "desc" },
    skip,
    take,
  });
};

module.exports = {
  findOpenByStudentAndConcept,
  ensureOpen,
  ensureClosed,
  findAllOpenByStudent,
  findAllOpenByStudents,
  findHistoryByStudent,
};
