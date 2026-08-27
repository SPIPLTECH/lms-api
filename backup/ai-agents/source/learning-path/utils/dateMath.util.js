const startOfDay = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const addDays = (date, days) => new Date(date.getTime() + days * 24 * 3600 * 1000);

/** Monday of the ISO week containing `date`, UTC-normalized. */
const startOfWeek = (date) => {
  const day = startOfDay(date);
  const weekday = day.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (weekday + 6) % 7;
  return addDays(day, -daysSinceMonday);
};

module.exports = { startOfDay, addDays, startOfWeek };
