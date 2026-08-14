const prisma = require("../../../config/database");

const upsertByStateId = (stateId, fields, client = prisma) => {
  return client.studentRisk.upsert({
    where: { stateId },
    create: { stateId, ...fields },
    update: fields,
  });
};

const findByStateId = (stateId, client = prisma) => {
  return client.studentRisk.findUnique({ where: { stateId } });
};

/**
 * Institution-wide high-risk roster — one real query via the state relation,
 * for cross-agent consumers (e.g. Admin Intelligence's risk detection) that
 * need "who is at risk platform-wide" rather than one student at a time.
 */
const findHighRisk = (levels = ["HIGH"], client = prisma) =>
  client.studentRisk.findMany({
    where: { dropoutRiskLevel: { in: levels } },
    include: { state: { select: { studentId: true } } },
    orderBy: { dropoutRiskScore: "desc" },
  });

module.exports = { upsertByStateId, findByStateId, findHighRisk };
