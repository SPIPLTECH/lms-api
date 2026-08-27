const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const safeDivide = (numerator, denominator, fallback = 0) => {
  if (!denominator) return fallback;
  return numerator / denominator;
};

const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

const stdDev = (values) => {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = mean(values.map((v) => (v - avg) ** 2));
  return Math.sqrt(variance);
};

module.exports = { clamp, round2, safeDivide, mean, stdDev };
