/**
 * Builds a Prisma `createdAt` where-clause from optional startDate/endDate.
 * Returns undefined (no filter) when neither bound is supplied.
 */
const buildCreatedAtFilter = (startDate, endDate) => {
  if (!startDate && !endDate) return undefined;

  const filter = {};
  if (startDate) filter.gte = new Date(startDate);
  if (endDate) filter.lte = new Date(endDate);
  return filter;
};

/**
 * Start/end of "today" in server-local time. Statistics/observation
 * endpoints are not timezone-aware per student yet — a documented
 * limitation for the future Analytics Agent to refine.
 */
const getTodayRange = () => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { startOfDay, endOfDay };
};

module.exports = {
  buildCreatedAtFilter,
  getTodayRange,
};
