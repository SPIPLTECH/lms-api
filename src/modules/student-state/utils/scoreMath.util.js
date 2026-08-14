const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const safeDivide = (numerator, denominator, fallback = 0) => {
  if (!denominator) return fallback;
  return numerator / denominator;
};

/** @param {{value: number, weight: number}[]} terms */
const weightedAverage = (terms) => {
  const totalWeight = terms.reduce((sum, t) => sum + t.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = terms.reduce((sum, t) => sum + t.value * t.weight, 0);
  return weightedSum / totalWeight;
};

module.exports = {
  clamp,
  round2,
  safeDivide,
  weightedAverage,
};
