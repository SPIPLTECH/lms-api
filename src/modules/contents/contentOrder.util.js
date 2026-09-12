const prisma = require("../../config/database");

/**
 * Next order for a given parent scope, considering BOTH Content and Quiz
 * rows already occupying that scope — this is what makes the two types
 * share one ordering sequence per parent. `field` is one of courseId/
 * moduleId/lessonId/topicId, already resolved by the caller (Content has
 * exactly one set; Quiz resolves the most-specific one — see
 * quiz.service.js's resolveQuizParentField).
 */
const getNextOrder = async (field, id) => {
  const [maxContent, maxQuiz] = await Promise.all([
    prisma.content.findFirst({ where: { [field]: id }, orderBy: { order: "desc" }, select: { order: true } }),
    prisma.quiz.findFirst({ where: { [field]: id, order: { not: null } }, orderBy: { order: "desc" }, select: { order: true } }),
  ]);
  return Math.max(maxContent?.order ?? 0, maxQuiz?.order ?? 0) + 1;
};

module.exports = { getNextOrder };
