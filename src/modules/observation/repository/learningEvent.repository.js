const prisma = require("../../../config/database");

/**
 * Pure data-access layer for LearningEvent. No validation, no business
 * rules, no event publishing — that belongs to the service layer. Every
 * method takes a Prisma-shaped object and returns a Prisma-shaped result,
 * so the service can swap this repository's implementation (e.g. a
 * ClickHouse-backed one for cold storage) without changing its own code.
 */

const create = (data) => {
  return prisma.learningEvent.create({ data });
};

const findById = (id) => {
  return prisma.learningEvent.findUnique({ where: { id } });
};

/**
 * Full chronological history for one student — event-sourcing replay input
 * for consumers (e.g. the Student State Agent's recalculate) that need to
 * fold over everything in order, not a paginated page of it.
 */
const findAllByStudentChronological = (studentId) => {
  return prisma.learningEvent.findMany({
    where: { studentId },
    orderBy: { createdAt: "asc" },
  });
};

const findByStudent = ({ studentId, where = {}, skip, take }) => {
  return prisma.learningEvent.findMany({
    where: { studentId, ...where },
    orderBy: { createdAt: "desc" },
    skip,
    take,
  });
};

const countByStudent = ({ studentId, where = {} }) => {
  return prisma.learningEvent.count({
    where: { studentId, ...where },
  });
};

const findByCourse = ({ courseId, where = {}, skip, take }) => {
  return prisma.learningEvent.findMany({
    where: { courseId, ...where },
    orderBy: { createdAt: "desc" },
    skip,
    take,
  });
};

const countByCourse = ({ courseId, where = {} }) => {
  return prisma.learningEvent.count({
    where: { courseId, ...where },
  });
};

const findBySession = ({ sessionId, skip, take }) => {
  return prisma.learningEvent.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    skip,
    take,
  });
};

const countBySession = ({ sessionId }) => {
  return prisma.learningEvent.count({ where: { sessionId } });
};

const findToday = ({ studentId, startOfDay, endOfDay }) => {
  return prisma.learningEvent.findMany({
    where: {
      studentId,
      createdAt: { gte: startOfDay, lte: endOfDay },
    },
    orderBy: { createdAt: "desc" },
  });
};

const groupCountByType = (where) => {
  return prisma.learningEvent.groupBy({
    by: ["eventType"],
    where,
    _count: { _all: true },
  });
};

const groupCountByCategory = (where) => {
  return prisma.learningEvent.groupBy({
    by: ["eventCategory"],
    where,
    _count: { _all: true },
  });
};

const countDistinctSessions = async (where) => {
  const rows = await prisma.learningEvent.findMany({
    where,
    distinct: ["sessionId"],
    select: { sessionId: true },
  });
  return rows.length;
};

const totalCount = (where) => {
  return prisma.learningEvent.count({ where });
};

module.exports = {
  create,
  findById,
  findAllByStudentChronological,
  findByStudent,
  countByStudent,
  findByCourse,
  countByCourse,
  findBySession,
  countBySession,
  findToday,
  groupCountByType,
  groupCountByCategory,
  countDistinctSessions,
  totalCount,
};
