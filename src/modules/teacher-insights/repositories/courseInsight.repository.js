const prisma = require("../../../config/database");
const { INSIGHT_STATUS } = require("../constants");

const findActiveByCourse = (courseId, { insightType } = {}, client = prisma) =>
  client.courseInsight.findMany({
    where: { courseId, status: INSIGHT_STATUS.ACTIVE, insightType: insightType || undefined },
    orderBy: [{ priority: "desc" }, { confidenceScore: "desc" }],
  });

const findAllActiveKeys = (courseId, client = prisma) =>
  client.courseInsight.findMany({
    where: { courseId, status: INSIGHT_STATUS.ACTIVE },
    select: { id: true, insightType: true, dedupeKey: true },
  });

const findById = (id, client = prisma) => client.courseInsight.findUnique({ where: { id } });

const upsertCandidate = (courseId, candidate, client = prisma) =>
  client.courseInsight.upsert({
    where: { courseId_insightType_dedupeKey: { courseId, insightType: candidate.insightType, dedupeKey: candidate.dedupeKey } },
    create: {
      courseId,
      insightType: candidate.insightType,
      dedupeKey: candidate.dedupeKey,
      priority: candidate.priority,
      status: INSIGHT_STATUS.ACTIVE,
      confidenceScore: candidate.confidence,
      title: candidate.title,
      reason: candidate.reason,
      affectedStudentCount: candidate.affectedStudentCount || 0,
      evidence: candidate.evidence || undefined,
      moduleId: candidate.moduleId || null,
      lessonId: candidate.lessonId || null,
      quizId: candidate.quizId || null,
      assignmentId: candidate.assignmentId || null,
      version: 1,
    },
    update: {
      priority: candidate.priority,
      status: INSIGHT_STATUS.ACTIVE,
      confidenceScore: candidate.confidence,
      title: candidate.title,
      reason: candidate.reason,
      affectedStudentCount: candidate.affectedStudentCount || 0,
      evidence: candidate.evidence || undefined,
      moduleId: candidate.moduleId || null,
      lessonId: candidate.lessonId || null,
      quizId: candidate.quizId || null,
      assignmentId: candidate.assignmentId || null,
      version: { increment: 1 },
      generatedAt: new Date(),
    },
  });

const updateStatus = (id, status, client = prisma) => client.courseInsight.update({ where: { id }, data: { status } });

const countByCourse = (courseId, client = prisma) => client.courseInsight.count({ where: { courseId } });

module.exports = { findActiveByCourse, findAllActiveKeys, findById, upsertCandidate, updateStatus, countByCourse };
