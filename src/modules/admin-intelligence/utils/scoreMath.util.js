const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

const average = (values) => (values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length);

const round2 = (value) => Math.round(value * 100) / 100;

const percent = (numerator, denominator) => (denominator === 0 ? 0 : round2((numerator / denominator) * 100));

/** % change from `from` to `to`; 0 when `from` is 0 to avoid Infinity/NaN on a zero baseline. */
const percentChange = (from, to) => (from === 0 ? (to === 0 ? 0 : 100) : round2(((to - from) / Math.abs(from)) * 100));

module.exports = { clamp, average, round2, percent, percentChange };
