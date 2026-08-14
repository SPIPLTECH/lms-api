const { REMINDER_CADENCE } = require("../../constants");

const CADENCE_DAYS = { [REMINDER_CADENCE.DAILY]: 1, [REMINDER_CADENCE.WEEKLY]: 7 };

/**
 * Computes the next run time for a reminder cadence: the next occurrence of
 * `preferredHour` (UTC) that's strictly after `now`. For WEEKLY, this locks
 * to whatever day-of-week the schedule was first created/advanced from,
 * rather than a configurable day — sufficient for "remind me weekly."
 *
 * @param {string} cadence - REMINDER_CADENCE value.
 * @param {number} preferredHour - 0-23.
 * @param {Date} now
 * @param {Date} [from] - base date to advance from (defaults to `now`); pass the previous nextRunAt when advancing an already-scheduled reminder.
 */
const computeNextRunAt = (cadence, preferredHour, now, from = now) => {
  const stepDays = CADENCE_DAYS[cadence] || 1;

  const candidate = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), preferredHour, 0, 0, 0));

  while (candidate <= now) {
    candidate.setUTCDate(candidate.getUTCDate() + stepDays);
  }

  return candidate;
};

module.exports = { computeNextRunAt };
