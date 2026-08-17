const prisma = require("../../../config/database");

/** Genuinely append-only orchestration audit ledger — one row per real downstream agent call, never updated. */
const createMany = (conversationId, messageId, results, client = prisma) =>
  client.agentInvocation.createMany({
    data: results.map((r) => ({
      conversationId,
      messageId: messageId || null,
      agentName: r.agentName,
      method: r.method,
      status: r.status,
      durationMs: r.durationMs,
      // Presence flag only, not the actual payload — the invocation ledger
      // is an operational audit trail, not a second copy of student data.
      resultSummary: r.status === "SUCCESS" ? { present: Boolean(r.data) } : undefined,
      errorMessage: r.errorMessage || null,
    })),
  });

const findByConversation = (conversationId, client = prisma) =>
  client.agentInvocation.findMany({ where: { conversationId }, orderBy: { invokedAt: "desc" } });

module.exports = { createMany, findByConversation };
