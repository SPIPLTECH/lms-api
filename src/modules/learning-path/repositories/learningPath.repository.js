const prisma = require("../../../config/database");

const findByStudent = (studentId, client = prisma) => client.learningPath.findUnique({ where: { studentId } });

/** Batch read for cross-agent consumers aggregating many students at once (e.g. Teacher Insight's class-wide reads) — one query instead of N. */
const findByStudents = (studentIds, client = prisma) => client.learningPath.findMany({ where: { studentId: { in: studentIds } } });

/** Live current row, version-bumped in place — same pattern as CourseHealth/StudentLearningState/CareerProfile. */
const upsert = (studentId, fields, now = new Date(), client = prisma) =>
  client.learningPath.upsert({
    where: { studentId },
    create: { studentId, ...fields, version: 1, lastCalculatedAt: now },
    update: { ...fields, version: { increment: 1 }, lastCalculatedAt: now },
  });

module.exports = { findByStudent, findByStudents, upsert };
