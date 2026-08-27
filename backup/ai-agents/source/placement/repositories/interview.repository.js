const prisma = require("../../../config/database");

const findByStudent = (studentId, client = prisma) => client.interview.findMany({ where: { studentId }, orderBy: { scheduledAt: "desc" } });

const findByApplication = (applicationId, client = prisma) =>
  client.interview.findMany({ where: { applicationId }, orderBy: { round: "asc" } });

module.exports = { findByStudent, findByApplication };
