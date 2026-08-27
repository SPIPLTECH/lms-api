const prisma = require("../../../config/database");

const findByConversation = (conversationId, client = prisma) => client.conversationSummary.findUnique({ where: { conversationId } });

/** Current-row, regenerated in place as the conversation grows past the compaction threshold. */
const upsert = (conversationId, { summaryText, keyTopics, messageCountAtSummary }, client = prisma) =>
  client.conversationSummary.upsert({
    where: { conversationId },
    create: { conversationId, summaryText, keyTopics, messageCountAtSummary },
    update: { summaryText, keyTopics, messageCountAtSummary, version: { increment: 1 } },
  });

module.exports = { findByConversation, upsert };
