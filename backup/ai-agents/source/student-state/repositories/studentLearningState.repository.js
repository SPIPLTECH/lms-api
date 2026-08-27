const prisma = require("../../../config/database");

const findRootByStudentId = (studentId, client = prisma) => {
  return client.studentLearningState.findUnique({ where: { studentId } });
};

const findRootWithRelations = (studentId, client = prisma) => {
  return client.studentLearningState.findUnique({
    where: { studentId },
    include: { progress: true, performance: true, engagement: true, behavior: true, risk: true },
  });
};

/**
 * Batch read for cross-agent consumers that need many students' full state
 * in one query (e.g. Teacher Insight aggregating a whole class) instead of
 * N individual findRootWithRelations calls.
 */
const findManyWithRelations = (studentIds, client = prisma) => {
  return client.studentLearningState.findMany({
    where: { studentId: { in: studentIds } },
    include: { progress: true, performance: true, engagement: true, behavior: true, risk: true },
  });
};

const upsertRoot = (studentId, stateFields, client = prisma) => {
  return client.studentLearningState.upsert({
    where: { studentId },
    create: { studentId, ...stateFields },
    update: stateFields,
  });
};

/**
 * Recently-active students, for the reconciliation scheduler. Bounded to a
 * window rather than "everyone ever" — a student inactive well past the
 * high-risk threshold has already saturated at max risk and doesn't need
 * re-checking every run.
 */
const findRecentlyActiveStudentIds = (sinceDate, client = prisma) => {
  return client.studentLearningState
    .findMany({
      where: { engagement: { lastActiveAt: { gte: sinceDate } } },
      select: { studentId: true },
    })
    .then((rows) => rows.map((r) => r.studentId));
};

module.exports = {
  findRootByStudentId,
  findRootWithRelations,
  findManyWithRelations,
  upsertRoot,
  findRecentlyActiveStudentIds,
};
