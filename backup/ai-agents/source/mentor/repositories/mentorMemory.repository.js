const prisma = require("../../../config/database");

const findAllByUser = (userId, client = prisma) => client.mentorMemory.findMany({ where: { userId } });

/** Current-row upsert per (userId, memoryKey) — same pattern as CourseHealth/StudentLearningState. */
const upsert = (userId, memoryKey, value, client = prisma) =>
  client.mentorMemory.upsert({
    where: { userId_memoryKey: { userId, memoryKey } },
    create: { userId, memoryKey, value },
    update: { value },
  });

const upsertMany = async (userId, facts, client = prisma) => {
  for (const [memoryKey, value] of Object.entries(facts)) {
    await upsert(userId, memoryKey, value, client);
  }
};

module.exports = { findAllByUser, upsert, upsertMany };
