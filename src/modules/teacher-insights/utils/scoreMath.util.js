const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

const round2 = (value) => Math.round(value * 100) / 100;

const average = (numbers) => (numbers.length === 0 ? 0 : numbers.reduce((a, b) => a + b, 0) / numbers.length);

const percent = (numerator, denominator) => (denominator === 0 ? 0 : round2((numerator / denominator) * 100));

const daysBetween = (later, earlier) => (later.getTime() - earlier.getTime()) / (24 * 3600 * 1000);

module.exports = { clamp, round2, average, percent, daysBetween };
