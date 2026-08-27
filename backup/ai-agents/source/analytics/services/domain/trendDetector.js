const { TREND_DIRECTION, TREND_WINDOW_DAYS, TREND_STABLE_THRESHOLD_PERCENT } = require("../../constants");
const { percentChange, average, round2 } = require("../../utils/scoreMath.util");

/**
 * Generic trend classifier applied uniformly to every metric — not one
 * detector per metric, since "is this going up, down, or flat" is the same
 * question regardless of which of the 23 metric keys is being asked.
 *
 * Compares `currentValue` against the average of whatever AnalyticsHistory
 * rows fall in the *previous* window (i.e. [now-2*windowDays, now-windowDays)),
 * not the current window — the current window's own average would just be
 * a smoothed version of currentValue, not a real prior baseline.
 *
 * @param {{date: Date|string, value: number}[]} historyRows
 * @param {number} currentValue
 * @param {number} [windowDays]
 * @returns {import("../../types/analytics.types").TrendResult}
 */
const detectTrend = (historyRows, currentValue, windowDays = TREND_WINDOW_DAYS) => {
  const now = Date.now();
  const windowMs = windowDays * 24 * 3600 * 1000;

  const previousWindowRows = historyRows.filter((row) => {
    const t = new Date(row.date).getTime();
    return t >= now - 2 * windowMs && t < now - windowMs;
  });

  // No prior-window history yet (new metric/scope) -> nothing to compare against, call it STABLE rather than a misleading 0%-baseline spike.
  const previousValue = previousWindowRows.length ? round2(average(previousWindowRows.map((row) => row.value))) : currentValue;
  const changePercent = percentChange(previousValue, currentValue);

  const direction =
    Math.abs(changePercent) < TREND_STABLE_THRESHOLD_PERCENT
      ? TREND_DIRECTION.STABLE
      : changePercent > 0
        ? TREND_DIRECTION.UP
        : TREND_DIRECTION.DOWN;

  return { direction, changePercent, currentValue, previousValue, windowDays };
};

module.exports = { detectTrend };
