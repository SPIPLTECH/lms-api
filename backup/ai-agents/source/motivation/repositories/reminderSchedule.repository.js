const prisma = require("../../../config/database");

const findByStudent = (studentId, client = prisma) => client.reminderSchedule.findMany({ where: { studentId } });

const findDue = (now, client = prisma) =>
  client.reminderSchedule.findMany({ where: { isActive: true, nextRunAt: { lte: now } } });

/** Creates the schedule if it doesn't exist yet, or refreshes its cadence/hour without disturbing nextRunAt. */
const ensureSchedule = (studentId, { reminderType, cadence, preferredHour, nextRunAt }, client = prisma) =>
  client.reminderSchedule.upsert({
    where: { studentId_reminderType: { studentId, reminderType } },
    create: { studentId, reminderType, cadence, preferredHour, nextRunAt, isActive: true },
    update: { cadence, preferredHour },
  });

const markRun = (id, { lastRunAt, nextRunAt }, client = prisma) =>
  client.reminderSchedule.update({ where: { id }, data: { lastRunAt, nextRunAt } });

const setActive = (id, isActive, client = prisma) => client.reminderSchedule.update({ where: { id }, data: { isActive } });

module.exports = { findByStudent, findDue, ensureSchedule, markRun, setActive };
