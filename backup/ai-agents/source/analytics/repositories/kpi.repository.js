const prisma = require("../../../config/database");

const findByScope = (scopeType, scopeId, client = prisma) =>
  client.kPI.findMany({ where: { scopeType, scopeId }, orderBy: { metricKey: "asc" } });

const findOne = (scopeType, scopeId, metricKey, client = prisma) =>
  client.kPI.findUnique({ where: { scopeType_scopeId_metricKey: { scopeType, scopeId, metricKey } } });

/** One real IN-query for many scopeIds of the same type — used by cross-agent batch getters (e.g. Admin Intelligence's per-department course rollup), not a per-id loop. */
const findByScopesBatch = (scopeType, scopeIds, client = prisma) =>
  client.kPI.findMany({ where: { scopeType, scopeId: { in: scopeIds } }, orderBy: { scopeId: "asc" } });

/** Live current value, version-bumped in place — same pattern as CourseHealth/StudentLearningState. */
const upsert = (scopeType, scopeId, record, now = new Date(), client = prisma) =>
  client.kPI.upsert({
    where: { scopeType_scopeId_metricKey: { scopeType, scopeId, metricKey: record.metricKey } },
    create: {
      scopeType,
      scopeId,
      metricKey: record.metricKey,
      value: record.value,
      unit: record.unit || null,
      trend: record.trend || null,
      changePercent: record.changePercent ?? null,
      metadata: record.metadata || undefined,
      version: 1,
      lastCalculatedAt: now,
    },
    update: {
      value: record.value,
      unit: record.unit || null,
      trend: record.trend || null,
      changePercent: record.changePercent ?? null,
      metadata: record.metadata || undefined,
      version: { increment: 1 },
      lastCalculatedAt: now,
    },
  });

module.exports = { findByScope, findOne, upsert, findByScopesBatch };
