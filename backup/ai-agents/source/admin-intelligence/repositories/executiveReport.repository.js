const prisma = require("../../../config/database");

const findById = (id, client = prisma) => client.executiveReport.findUnique({ where: { id } });

const findByType = (reportType, client = prisma) =>
  client.executiveReport.findMany({ where: { reportType: reportType || undefined }, orderBy: { periodStart: "desc" } });

/** Get-or-generate semantics — same period upserts in place, same shape as Analytics' report.repository.js#upsertReport. */
const upsertReport = (fields, client = prisma) =>
  client.executiveReport.upsert({
    where: { reportType_periodStart: { reportType: fields.reportType, periodStart: fields.periodStart } },
    create: fields,
    update: {
      periodEnd: fields.periodEnd,
      summary: fields.summary,
      healthSnapshot: fields.healthSnapshot,
      departmentSummary: fields.departmentSummary,
      facultySummary: fields.facultySummary,
      insights: fields.insights,
      recommendations: fields.recommendations,
      alerts: fields.alerts,
      forecasts: fields.forecasts,
      version: { increment: 1 },
      generatedAt: new Date(),
    },
  });

module.exports = { findById, findByType, upsertReport };
