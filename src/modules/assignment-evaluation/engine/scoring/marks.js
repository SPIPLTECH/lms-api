'use strict';

const EPS = 1e-9;

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function isMultipleOf(value, step) {
  const q = value / step;
  return Math.abs(q - Math.round(q)) < 1e-6;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Converts criterion satisfaction (0..1) into marks on the question's mark
 * step. Partial evidence never earns full marks and, once over the minimum
 * threshold, never rounds down to zero.
 */
function marksForSatisfaction(satisfaction, maxMarks, step, policy) {
  if (satisfaction >= policy.fullCreditThreshold - EPS) return maxMarks;
  if (satisfaction < policy.minCreditThreshold) return 0;
  if (maxMarks <= step + EPS) return satisfaction >= 0.5 ? maxMarks : 0;
  let m = Math.round((satisfaction * maxMarks) / step) * step;
  if (m >= maxMarks) m = maxMarks - step;
  if (m <= 0) m = step;
  return round2(clamp(m, 0, maxMarks));
}

module.exports = { round2, isMultipleOf, clamp, marksForSatisfaction, EPS };
