const truncateToUtcDay = (date = new Date()) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const addDays = (date, days) => new Date(date.getTime() + days * 24 * 3600 * 1000);

module.exports = { truncateToUtcDay, addDays };
