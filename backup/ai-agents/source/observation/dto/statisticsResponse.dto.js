/**
 * Shapes raw Prisma groupBy() results into a statistics response.
 * Deliberately limited to counts/breakdowns — no derived scores. Any
 * "what does this mean" interpretation belongs to the Analytics Agent.
 */
const toStatisticsResponse = ({ totalEvents, totalSessions, byType, byCategory }) => ({
  totalEvents,
  totalSessions,
  eventsByType: byType.reduce((acc, row) => {
    acc[row.eventType] = row._count._all;
    return acc;
  }, {}),
  eventsByCategory: byCategory.reduce((acc, row) => {
    acc[row.eventCategory] = row._count._all;
    return acc;
  }, {}),
});

module.exports = { toStatisticsResponse };
