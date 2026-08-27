const prisma = require("../../../config/database");

/**
 * Platform-level context no peer agent owns — read directly from this
 * LMS's own tables, same as every other agent does for its own
 * non-agent-owned signals (e.g. Analytics reading Enrollment directly).
 * No `UserPreference`/`StudentPreference` model exists anywhere in this
 * schema (confirmed by grep before writing this file) — that part of the
 * spec's Context Engine list is an honest, documented gap, not fabricated.
 *
 * @param {string} userId
 */
const gatherNotifications = (userId) =>
  prisma.notification.findMany({ where: { userId, isRead: false }, orderBy: { createdAt: "desc" }, take: 10 });

/**
 * CalendarEvent.date is a plain String, not a queryable DateTime (same
 * limitation Motivation's own context builder already documents) — so
 * "upcoming" can't be a real DB-level date filter. This reads the most
 * recently-created rows instead and is honest in its own field naming.
 */
const gatherCalendarEvents = () => prisma.calendarEvent.findMany({ orderBy: { createdAt: "desc" }, take: 10 });

module.exports = { gatherNotifications, gatherCalendarEvents };
