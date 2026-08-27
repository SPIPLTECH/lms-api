const prisma = require("../../../config/database");

const findByStudent = (studentId, client = prisma) => client.offer.findMany({ where: { studentId }, orderBy: { offeredAt: "desc" } });

const findByApplication = (applicationId, client = prisma) => client.offer.findUnique({ where: { applicationId } });

module.exports = { findByStudent, findByApplication };
