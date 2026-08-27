const prisma = require("../../../config/database");
const { ALERT_STATUS } = require("../constants");

const findActive = ({ scopeType, priority } = {}, client = prisma) =>
  client.adminAlert.findMany({
    where: { status: ALERT_STATUS.ACTIVE, scopeType: scopeType || undefined, priority: priority || undefined },
    orderBy: [{ priority: "desc" }, { generatedAt: "desc" }],
  });

const findAllActiveKeys = async (client = prisma) =>
  client.adminAlert.findMany({ where: { status: ALERT_STATUS.ACTIVE }, select: { id: true, scopeType: true, scopeId: true, dedupeKey: true } });

/** Same lifecycle as StudentAlert: ACTIVE until the underlying condition clears on the next run, then auto-flipped to RESOLVED — never a manual acknowledge/dismiss endpoint. */
const upsertCandidate = (candidate, client = prisma) =>
  client.adminAlert.upsert({
    where: { scopeType_scopeId_dedupeKey: { scopeType: candidate.scopeType, scopeId: candidate.scopeId, dedupeKey: candidate.dedupeKey } },
    create: {
      scopeType: candidate.scopeType,
      scopeId: candidate.scopeId,
      alertType: candidate.alertType,
      priority: candidate.priority,
      status: ALERT_STATUS.ACTIVE,
      dedupeKey: candidate.dedupeKey,
      reason: candidate.reason,
      evidence: candidate.evidence || undefined,
      version: 1,
    },
    update: {
      status: ALERT_STATUS.ACTIVE,
      priority: candidate.priority,
      reason: candidate.reason,
      evidence: candidate.evidence || undefined,
      version: { increment: 1 },
    },
  });

const updateStatus = (id, status, client = prisma) => client.adminAlert.update({ where: { id }, data: { status } });

module.exports = { findActive, findAllActiveKeys, upsertCandidate, updateStatus };
