const prisma = require("../../../config/database");
const { CONVERSATION_STATUS } = require("../constants");

const create = (userId, userRole, client = prisma) =>
  client.mentorConversation.create({ data: { userId, userRole, status: CONVERSATION_STATUS.ACTIVE } });

const findById = (id, client = prisma) => client.mentorConversation.findUnique({ where: { id } });

const findByUser = (userId, { page = 1, limit = 20 } = {}, client = prisma) =>
  client.mentorConversation.findMany({
    where: { userId, status: CONVERSATION_STATUS.ACTIVE },
    orderBy: { lastMessageAt: "desc" },
    skip: (page - 1) * limit,
    take: limit,
  });

const countByUser = (userId, client = prisma) => client.mentorConversation.count({ where: { userId, status: CONVERSATION_STATUS.ACTIVE } });

const touch = (id, { title, lastIntent } = {}, client = prisma) =>
  client.mentorConversation.update({
    where: { id },
    data: { lastMessageAt: new Date(), title: title || undefined, lastIntent: lastIntent || undefined },
  });

const remove = (id, client = prisma) => client.mentorConversation.delete({ where: { id } });

module.exports = { create, findById, findByUser, countByUser, touch, remove };
