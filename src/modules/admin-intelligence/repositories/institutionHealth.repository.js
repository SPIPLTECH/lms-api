const prisma = require("../../../config/database");
const { truncateToUtcDay } = require("../utils/dateMath.util");

/** One row per day — the "current" row is simply the latest date, so a plain find-latest doubles as the live-state read. */
const findLatest = (client = prisma) => client.institutionHealth.findFirst({ orderBy: { date: "desc" } });

const findSince = (sinceDate, client = prisma) =>
  client.institutionHealth.findMany({ where: { date: { gte: truncateToUtcDay(sinceDate) } }, orderBy: { date: "asc" } });

const upsertDaily = (fields, date = new Date(), client = prisma) => {
  const day = truncateToUtcDay(date);
  return client.institutionHealth.upsert({
    where: { date: day },
    create: { date: day, ...fields },
    update: { ...fields, computedAt: new Date() },
  });
};

module.exports = { findLatest, findSince, upsertDaily };
