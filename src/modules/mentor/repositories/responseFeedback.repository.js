const prisma = require("../../../config/database");

const create = (messageId, userId, rating, comment, client = prisma) =>
  client.responseFeedback.create({ data: { messageId, userId, rating, comment: comment || null } });

const findByMessage = (messageId, client = prisma) => client.responseFeedback.findUnique({ where: { messageId } });

module.exports = { create, findByMessage };
