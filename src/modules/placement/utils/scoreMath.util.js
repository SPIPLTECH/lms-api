const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

const average = (values) => (values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length);

const round2 = (value) => Math.round(value * 100) / 100;

const percent = (numerator, denominator) => (denominator === 0 ? 0 : round2((numerator / denominator) * 100));

module.exports = { clamp, average, round2, percent };
