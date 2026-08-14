const prisma = require("../../../config/database");

const findByStudentAndCourse = (studentId, courseId, client = prisma) =>
  client.entryAssessment.findUnique({ where: { studentId_courseId: { studentId, courseId } } });

/** Current-row upsert, same "one row per (student, course), updated in place" convention as EntryAssessment's own doc comment. */
const upsert = (studentId, courseId, fields, client = prisma) =>
  client.entryAssessment.upsert({
    where: { studentId_courseId: { studentId, courseId } },
    create: { studentId, courseId, ...fields },
    update: fields,
  });

module.exports = { findByStudentAndCourse, upsert };
