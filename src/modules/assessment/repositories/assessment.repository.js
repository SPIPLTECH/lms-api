const prisma = require("../../../config/database");
const { ASSESSMENT_STATUS, ASSESSMENT_TYPE } = require("../constants");

/**
 * Finds the existing STANDARD Assessment wrapping this real quiz/assignment
 * for this student, or creates one. Retakes become new AssessmentAttempt
 * rows under the same Assessment — never a duplicate Assessment per retake.
 */
const findOrCreateStandard = async ({ studentId, courseId, quizId, assignmentId }, client = prisma) => {
  const where = quizId ? { studentId, quizId } : { studentId, assignmentId };

  const existing = await client.assessment.findFirst({ where: { ...where, type: ASSESSMENT_TYPE.STANDARD } });
  if (existing) return existing;

  return client.assessment.create({
    data: {
      studentId,
      courseId,
      quizId: quizId || null,
      assignmentId: assignmentId || null,
      type: ASSESSMENT_TYPE.STANDARD,
      status: ASSESSMENT_STATUS.IN_PROGRESS,
    },
  });
};

/**
 * Marks any prior active (RECOMMENDED/IN_PROGRESS) recommendation of this
 * type as EXPIRED, then creates the new one — so there's always exactly
 * one "current" recommendation per type, with the rest preserved as
 * history rather than overwritten.
 */
const replaceActiveRecommendation = async (studentId, recommendation, client = prisma) => {
  await client.assessment.updateMany({
    where: {
      studentId,
      type: recommendation.type,
      status: { in: [ASSESSMENT_STATUS.RECOMMENDED, ASSESSMENT_STATUS.IN_PROGRESS] },
    },
    data: { status: ASSESSMENT_STATUS.EXPIRED },
  });

  return client.assessment.create({
    data: {
      studentId,
      type: recommendation.type,
      status: ASSESSMENT_STATUS.RECOMMENDED,
      courseId: recommendation.courseId || null,
      targetConcepts: recommendation.targetConcepts,
      difficulty: recommendation.difficulty,
      rationale: recommendation.rationale,
    },
  });
};

const findCurrentRecommendations = (studentId, client = prisma) => {
  return client.assessment.findMany({
    where: {
      studentId,
      type: { in: [ASSESSMENT_TYPE.ADAPTIVE, ASSESSMENT_TYPE.REVISION] },
      status: ASSESSMENT_STATUS.RECOMMENDED,
    },
    orderBy: { createdAt: "desc" },
  });
};

const findByStudent = (studentId, { skip, take } = {}, client = prisma) => {
  return client.assessment.findMany({
    where: { studentId },
    orderBy: { createdAt: "desc" },
    skip,
    take,
    include: { attempts: { include: { result: true }, orderBy: { attemptNumber: "desc" } } },
  });
};

const countByStudent = (studentId, client = prisma) => client.assessment.count({ where: { studentId } });

module.exports = {
  findOrCreateStandard,
  replaceActiveRecommendation,
  findCurrentRecommendations,
  findByStudent,
  countByStudent,
};
