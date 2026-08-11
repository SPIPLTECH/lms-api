const {
  FORECAST_MIN_DATA_POINTS,
  FORECAST_HORIZON_DAYS,
  MIN_FORECAST_CONFIDENCE,
  MAX_FORECAST_CONFIDENCE,
  FORECAST_METHOD,
} = require("../../constants");
const { clamp, round2 } = require("../../utils/scoreMath.util");

/**
 * Least-squares linear regression over (dayOffset, value) pairs, projecting
 * `horizonDays` past the most recent data point. Same OLS shape as
 * Analytics' own forecastEngine.js — a separate copy per this codebase's
 * "each agent owns its own near-identical logic" convention, not a shared
 * import (independent deployability).
 *
 * Returns null below FORECAST_MIN_DATA_POINTS: too little history to
 * extrapolate honestly, no fabricated confidence.
 *
 * @param {{date: string, value: number}[]} historyPoints - day-bucketed, any order.
 * @param {number} [horizonDays]
 * @returns {import("../../types/adminIntelligence.types").ForecastResult|null}
 */
const forecastLinear = (historyPoints, horizonDays = FORECAST_HORIZON_DAYS) => {
  if (historyPoints.length < FORECAST_MIN_DATA_POINTS) return null;

  const sorted = [...historyPoints].sort((a, b) => (a.date < b.date ? -1 : 1));
  const dayMs = 24 * 3600 * 1000;
  const t0 = new Date(sorted[0].date).getTime();

  const xs = sorted.map((p) => (new Date(p.date).getTime() - t0) / dayMs);
  const ys = sorted.map((p) => p.value);
  const n = xs.length;

  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((sum, x, i) => sum + x * ys[i], 0);
  const sumXX = xs.reduce((sum, x) => sum + x * x, 0);

  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  const lastX = xs[n - 1];
  const targetX = lastX + horizonDays;
  const predictedValue = round2(Math.max(0, intercept + slope * targetX));

  const meanY = sumY / n;
  const totalSS = ys.reduce((sum, y) => sum + (y - meanY) ** 2, 0);
  const residualSS = ys.reduce((sum, y, i) => sum + (y - (intercept + slope * xs[i])) ** 2, 0);
  const rSquared = totalSS === 0 ? 1 : clamp(1 - residualSS / totalSS, 0, 1);

  const confidenceScore = Math.round(
    clamp(MIN_FORECAST_CONFIDENCE + rSquared * 50 + Math.min(n, 30) * 0.7, MIN_FORECAST_CONFIDENCE, MAX_FORECAST_CONFIDENCE)
  );

  return {
    predictedValue,
    confidenceScore,
    method: FORECAST_METHOD.LINEAR_REGRESSION,
    basedOnDataPoints: n,
    forecastDate: new Date(t0 + targetX * dayMs),
  };
};

module.exports = { forecastLinear };
