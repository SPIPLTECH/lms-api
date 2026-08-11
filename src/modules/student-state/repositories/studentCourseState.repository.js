const prisma = require("../../../config/database");

const findByStudentAndCourse = (studentId, courseId, client = prisma) =>
  client.studentCourseState.findUnique({ where: { studentId_courseId: { studentId, courseId } } });

/** Current-row upsert — one baseline per (student, course), updated in place on reassessment. */
const upsert = (studentId, courseId, fields, client = prisma) =>
  client.studentCourseState.upsert({
    where: { studentId_courseId: { studentId, courseId } },
    create: { studentId, courseId, ...fields },
    update: fields,
  });

module.exports = { findByStudentAndCourse, upsert };
