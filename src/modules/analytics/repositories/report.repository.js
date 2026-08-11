const prisma = require("../../../config/database");

const findById = (id, client = prisma) => client.report.findUnique({ where: { id } });

const findByScope = (scopeType, scopeId, { reportType } = {}, client = prisma) =>
  client.report.findMany({ where: { scopeType, scopeId, reportType: reportType || undefined }, orderBy: { periodStart: "desc" } });

const findByPeriod = (scopeType, scopeId, reportType, periodStart, client = prisma) =>
  client.report.findUnique({ where: { scopeType_scopeId_reportType_periodStart: { scopeType, scopeId, reportType, periodStart } } });

/** Get-or-generate semantics — same period upserts in place (a re-run of the same reportType/periodStart refreshes the numbers, not a duplicate row). */
const upsertReport = (scopeType, scopeId, fields, client = prisma) =>
  client.report.upsert({
    where: {
      scopeType_scopeId_reportType_periodStart: {
        scopeType,
        scopeId,
        reportType: fields.reportType,
        periodStart: fields.periodStart,
      },
    },
    create: { scopeType, scopeId, ...fields },
    update: {
      periodEnd: fields.periodEnd,
      summary: fields.summary,
      kpiSnapshot: fields.kpiSnapshot,
      trends: fields.trends,
      forecasts: fields.forecasts,
      version: { increment: 1 },
      generatedAt: new Date(),
    },
  });

module.exports = { findById, findByScope, findByPeriod, upsertReport };
