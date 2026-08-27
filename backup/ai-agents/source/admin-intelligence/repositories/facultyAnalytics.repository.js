const prisma = require("../../../config/database");
const { truncateToUtcDay } = require("../utils/dateMath.util");

/** Latest row per instructor — ordered desc then reduced in JS, same plain-Prisma style as departmentAnalytics.repository.js (no raw SQL). */
const findLatestAll = async (client = prisma) => {
  const rows = await client.facultyAnalytics.findMany({ orderBy: { date: "desc" } });
  const latestByInstructor = new Map();
  for (const row of rows) {
    if (!latestByInstructor.has(row.instructorId)) latestByInstructor.set(row.instructorId, row);
  }
  return [...latestByInstructor.values()];
};

const findByInstructor = (instructorId, sinceDate, client = prisma) =>
  client.facultyAnalytics.findMany({
    where: { instructorId, date: { gte: truncateToUtcDay(sinceDate) } },
    orderBy: { date: "asc" },
  });

const upsertDaily = (instructorId, fields, date = new Date(), client = prisma) => {
  const day = truncateToUtcDay(date);
  return client.facultyAnalytics.upsert({
    where: { instructorId_date: { instructorId, date: day } },
    create: { instructorId, date: day, ...fields },
    update: { ...fields, computedAt: new Date() },
  });
};

module.exports = { findLatestAll, findByInstructor, upsertDaily };
