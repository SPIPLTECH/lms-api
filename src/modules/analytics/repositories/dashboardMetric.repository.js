const prisma = require("../../../config/database");

const findByScope = (scopeType, scopeId, client = prisma) => client.dashboardMetric.findMany({ where: { scopeType, scopeId } });

const upsert = (scopeType, scopeId, dashboardKey, data, client = prisma) =>
  client.dashboardMetric.upsert({
    where: { scopeType_scopeId_dashboardKey: { scopeType, scopeId, dashboardKey } },
    create: { scopeType, scopeId, dashboardKey, data },
    update: { data, version: { increment: 1 }, computedAt: new Date() },
  });

module.exports = { findByScope, upsert };
