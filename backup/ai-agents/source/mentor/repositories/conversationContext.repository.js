const prisma = require("../../../config/database");

/** Genuinely append-only — one row per turn, never updated. The real "what did the mentor know when it answered this" audit record. */
const create = (conversationId, messageId, snapshot, agentsQueried, client = prisma) =>
  client.conversationContext.create({ data: { conversationId, messageId: messageId || null, snapshot, agentsQueried } });

const findByConversation = (conversationId, client = prisma) =>
  client.conversationContext.findMany({ where: { conversationId }, orderBy: { gatheredAt: "desc" } });

module.exports = { create, findByConversation };
