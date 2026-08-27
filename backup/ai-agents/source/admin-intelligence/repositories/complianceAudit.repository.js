const prisma = require("../../../config/database");

/** Genuinely append-only — every run inserts new rows, nothing is ever updated or deduplicated. This IS the audit ledger. */
const createMany = (candidates, client = prisma) => client.complianceAudit.createMany({ data: candidates });

const findRecent = ({ checkType, scopeType, limit = 50 } = {}, client = prisma) =>
  client.complianceAudit.findMany({
    where: { checkType: checkType || undefined, scopeType: scopeType || undefined },
    orderBy: { runAt: "desc" },
    take: limit,
  });

module.exports = { createMany, findRecent };
