const prisma = require("../../../config/database");

const findByCourseAndPeriod = (courseId, reportType, periodStart, client = prisma) =>
  client.teacherInsight.findUnique({ where: { courseId_reportType_periodStart: { courseId, reportType, periodStart } } });

const findLatestByCourse = (courseId, reportType, client = prisma) =>
  client.teacherInsight.findFirst({ where: { courseId, reportType }, orderBy: { periodStart: "desc" } });

const findByTeacher = (teacherId, reportType, { skip, take } = {}, client = prisma) =>
  client.teacherInsight.findMany({
    where: { teacherId, reportType: reportType || undefined },
    orderBy: { periodStart: "desc" },
    skip,
    take,
  });

/** Upserted by (courseId, reportType, periodStart) — recomputing the in-progress period refreshes it in place; past periods are naturally immutable once nothing regenerates them. */
const upsertReport = (courseId, teacherId, report, client = prisma) =>
  client.teacherInsight.upsert({
    where: { courseId_reportType_periodStart: { courseId, reportType: report.reportType, periodStart: report.periodStart } },
    create: {
      courseId,
      teacherId,
      reportType: report.reportType,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      summary: report.summary,
      highlights: report.highlights,
      confidenceScore: report.confidenceScore,
    },
    update: {
      summary: report.summary,
      highlights: report.highlights,
      confidenceScore: report.confidenceScore,
    },
  });

module.exports = { findByCourseAndPeriod, findLatestByCourse, findByTeacher, upsertReport };
