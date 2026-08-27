const { FORECAST_MIN_DATA_POINTS, FORECAST_HORIZON_DAYS, MIN_FORECAST_CONFIDENCE, MAX_FORECAST_CONFIDENCE } = require("../../constants");
const { clamp, round2 } = require("../../utils/scoreMath.util");

/**
 * Least-squares linear regression over (dayOffset, value) pairs, projecting
 * `horizonDays` past the most recent data point. One generic engine applied
 * to every metric's AnalyticsHistory — not a per-metric model.
 *
 * Returns null below FORECAST_MIN_DATA_POINTS: a metric with one or two
 * data points has no real trend to extrapolate, and a confidently-labeled
 * prediction from that little history would be fabricated precision, not
 * an honest forecast.
 *
 * @param {{date: Date|string, value: number}[]} historyPoints - any order.
 * @param {number} [horizonDays]
 * @returns {(import("../../types/analytics.types").ForecastResult & {forecastDate: Date})|null}
 */
const forecastLinear = (historyPoints, horizonDays = FORECAST_HORIZON_DAYS) => {
  if (historyPoints.length < FORECAST_MIN_DATA_POINTS) return null;

  const sorted = [...historyPoints].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
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
  const predictedValue = round2(intercept + slope * targetX);

  // R^2 as a fit-quality proxy, blended with sample size so a handful of
  // near-perfect points don't outrank thirty noisier-but-more-informative ones.
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
    method: "LINEAR_REGRESSION",
    basedOnDataPoints: n,
    forecastDate: new Date(t0 + targetX * dayMs),
  };
};

module.exports = { forecastLinear };
