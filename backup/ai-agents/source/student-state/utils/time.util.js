const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC for the given date's calendar day. */
const startOfUtcDay = (date) => {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/** Monday 00:00 UTC of the week containing `date`. */
const startOfUtcWeek = (date) => {
  const day = startOfUtcDay(date);
  const weekday = day.getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (weekday + 6) % 7;
  return new Date(day.getTime() - daysSinceMonday * DAY_MS);
};

const isSameUtcDay = (a, b) => startOfUtcDay(a).getTime() === startOfUtcDay(b).getTime();

const isSameUtcWeek = (a, b) => startOfUtcWeek(a).getTime() === startOfUtcWeek(b).getTime();

const wholeDaysBetween = (earlier, later) => {
  return Math.round((startOfUtcDay(later).getTime() - startOfUtcDay(earlier).getTime()) / DAY_MS);
};

/**
 * Rolls a "consecutive days" streak forward given the previous activity
 * date and a new activity timestamp.
 *   - same calendar day as before -> streak unchanged
 *   - exactly the next calendar day -> streak + 1
 *   - any gap (or no previous date) -> streak resets to 1
 */
const rollStreak = (previousDate, currentDate, previousStreak) => {
  if (!previousDate) return 1;

  const gap = wholeDaysBetween(previousDate, currentDate);

  if (gap === 0) return previousStreak;
  if (gap === 1) return previousStreak + 1;
  return 1;
};

module.exports = {
  startOfUtcDay,
  startOfUtcWeek,
  isSameUtcDay,
  isSameUtcWeek,
  wholeDaysBetween,
  rollStreak,
};
