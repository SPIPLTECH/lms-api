const prisma = require("../../../config/database");

const create = (conversationId, fields, client = prisma) =>
  client.mentorMessage.create({
    data: {
      conversationId,
      role: fields.role,
      content: fields.content,
      intent: fields.intent || null,
      intentConfidence: fields.intentConfidence ?? null,
      metadata: fields.metadata || undefined,
    },
  });

const findByConversation = (conversationId, client = prisma) =>
  client.mentorMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });

/** Most recent N, returned oldest-first (same order the prompt/message array needs). */
const findRecentByConversation = (conversationId, limit, client = prisma) =>
  client.mentorMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: limit }).then((rows) => rows.reverse());

const countByConversation = (conversationId, client = prisma) => client.mentorMessage.count({ where: { conversationId } });

const findById = (id, client = prisma) => client.mentorMessage.findUnique({ where: { id } });

module.exports = { create, findByConversation, findRecentByConversation, countByConversation, findById };
