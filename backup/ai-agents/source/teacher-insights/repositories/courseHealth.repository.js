const prisma = require("../../../config/database");

const findByCourse = (courseId, client = prisma) => client.courseHealth.findUnique({ where: { courseId } });

/** Singleton per course, version-bumped in place — same pattern as StudentLearningState. */
const upsert = (courseId, fields, now = new Date(), client = prisma) =>
  client.courseHealth.upsert({
    where: { courseId },
    create: { courseId, ...fields, version: 1, lastCalculatedAt: now },
    update: { ...fields, version: { increment: 1 }, lastCalculatedAt: now },
  });

module.exports = { findByCourse, upsert };
