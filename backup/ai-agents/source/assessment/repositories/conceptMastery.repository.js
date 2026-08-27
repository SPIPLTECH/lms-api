const prisma = require("../../../config/database");

const findByStudentAndConcept = (studentId, concept, client = prisma) => {
  return client.conceptMastery.findUnique({ where: { studentId_concept: { studentId, concept } } });
};

const findAllByStudent = (studentId, client = prisma) => {
  return client.conceptMastery.findMany({ where: { studentId }, orderBy: { concept: "asc" } });
};

const findByStudentAndConcepts = (studentId, concepts, client = prisma) => {
  return client.conceptMastery.findMany({ where: { studentId, concept: { in: concepts } } });
};

/** Batch read for cross-agent consumers aggregating many students' mastery in one query (e.g. Teacher Insight's class-wide concept analysis). */
const findAllByStudents = (studentIds, client = prisma) => {
  return client.conceptMastery.findMany({ where: { studentId: { in: studentIds } } });
};

const upsert = (studentId, concept, fields, client = prisma) => {
  return client.conceptMastery.upsert({
    where: { studentId_concept: { studentId, concept } },
    create: { studentId, concept, ...fields },
    update: fields,
  });
};

const findDueForReassessment = (studentId, now, client = prisma) => {
  return client.conceptMastery.findMany({
    where: { studentId, nextReassessmentAt: { lte: now } },
  });
};

module.exports = {
  findByStudentAndConcept,
  findAllByStudent,
  findByStudentAndConcepts,
  findAllByStudents,
  upsert,
  findDueForReassessment,
};
