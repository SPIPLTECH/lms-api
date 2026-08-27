const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

const round2 = (value) => Math.round(value * 100) / 100;

const hoursBetween = (later, earlier) => (later.getTime() - earlier.getTime()) / (3600 * 1000);

const daysBetween = (later, earlier) => hoursBetween(later, earlier) / 24;

module.exports = { clamp, round2, hoursBetween, daysBetween };
