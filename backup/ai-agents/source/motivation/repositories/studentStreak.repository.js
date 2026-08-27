const prisma = require("../../../config/database");

const findByStudent = (studentId, client = prisma) => client.studentStreak.findUnique({ where: { studentId } });

/** Batch read for cross-agent consumers aggregating many students' streaks in one query (e.g. Teacher Insight's class-wide reads). */
const findByStudents = (studentIds, client = prisma) =>
  client.studentStreak.findMany({ where: { studentId: { in: studentIds } } });

const upsert = (studentId, data, client = prisma) =>
  client.studentStreak.upsert({
    where: { studentId },
    create: { studentId, ...data },
    update: data,
  });

module.exports = { findByStudent, findByStudents, upsert };
