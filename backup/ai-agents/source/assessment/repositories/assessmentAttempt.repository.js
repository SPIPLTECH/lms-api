const prisma = require("../../../config/database");

/** Idempotency guard: has this LearningEvent already produced an attempt? */
const findBySourceEventId = (sourceEventId, client = prisma) => {
  if (!sourceEventId) return Promise.resolve(null);
  return client.assessmentAttempt.findFirst({ where: { sourceEventId } });
};

const create = async (assessmentId, fields, client = prisma) => {
  const lastAttempt = await client.assessmentAttempt.findFirst({
    where: { assessmentId },
    orderBy: { attemptNumber: "desc" },
  });

  return client.assessmentAttempt.create({
    data: { assessmentId, attemptNumber: (lastAttempt?.attemptNumber || 0) + 1, ...fields },
  });
};

const findByStudent = (studentId, { skip, take } = {}, client = prisma) => {
  return client.assessmentAttempt.findMany({
    where: { studentId },
    orderBy: { submittedAt: "desc" },
    skip,
    take,
    include: { result: true, assessment: true },
  });
};

module.exports = { findBySourceEventId, create, findByStudent };
