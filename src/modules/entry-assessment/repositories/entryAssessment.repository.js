const prisma = require("../../../config/database");

const findByStudentAndCourse = (studentId, courseId, client = prisma) =>
  client.entryAssessment.findUnique({ where: { studentId_courseId: { studentId, courseId } } });

/** Current-row upsert, one row per (student, course), updated in place. */
const upsert = (studentId, courseId, fields, client = prisma) =>
  client.entryAssessment.upsert({
    where: { studentId_courseId: { studentId, courseId } },
    create: { studentId, courseId, ...fields },
    update: fields,
  });

module.exports = { findByStudentAndCourse, upsert };
