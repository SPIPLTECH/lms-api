const prisma = require("../../../config/database");
const { truncateToUtcDay } = require("../utils/dateMath.util");

/** Latest row per department — ordered desc then reduced in JS to first-seen-per-key, same plain-Prisma style as every other repository in this codebase (no raw SQL). */
const findLatestAll = async (client = prisma) => {
  const rows = await client.departmentAnalytics.findMany({ orderBy: { date: "desc" } });
  const latestByDepartment = new Map();
  for (const row of rows) {
    if (!latestByDepartment.has(row.departmentKey)) latestByDepartment.set(row.departmentKey, row);
  }
  return [...latestByDepartment.values()];
};

const findByDepartment = (departmentKey, sinceDate, client = prisma) =>
  client.departmentAnalytics.findMany({
    where: { departmentKey, date: { gte: truncateToUtcDay(sinceDate) } },
    orderBy: { date: "asc" },
  });

const upsertDaily = (departmentKey, fields, date = new Date(), client = prisma) => {
  const day = truncateToUtcDay(date);
  return client.departmentAnalytics.upsert({
    where: { departmentKey_date: { departmentKey, date: day } },
    create: { departmentKey, date: day, ...fields },
    update: { ...fields, computedAt: new Date() },
  });
};

module.exports = { findLatestAll, findByDepartment, upsertDaily };
