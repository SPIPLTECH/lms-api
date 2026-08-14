const { REPORT_TYPE } = require("../../constants");

/**
 * Bucketed period start (UTC) per report type — not a rolling "now - N
 * days" window. A rolling window would make every generation land on a
 * slightly different periodStart, defeating Report's
 * @@unique([scopeType, scopeId, reportType, periodStart]) upsert: repeated
 * calls within the same real-world period (e.g. the same ISO week) must
 * resolve to the same periodStart to actually get-or-generate rather than
 * silently accumulate near-duplicate rows.
 *
 * @param {"WEEKLY"|"MONTHLY"|"QUARTERLY"|"ANNUAL"} reportType
 * @param {Date} now
 * @returns {Date}
 */
const resolvePeriodStart = (reportType, now) => {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  switch (reportType) {
    case REPORT_TYPE.WEEKLY: {
      const weekday = day.getUTCDay(); // 0=Sun..6=Sat
      const daysSinceMonday = (weekday + 6) % 7;
      day.setUTCDate(day.getUTCDate() - daysSinceMonday);
      return day;
    }
    case REPORT_TYPE.MONTHLY:
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    case REPORT_TYPE.QUARTERLY: {
      const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
      return new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1));
    }
    case REPORT_TYPE.ANNUAL:
      return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    default:
      throw new Error(`Unknown report type: ${reportType}`);
  }
};

module.exports = { resolvePeriodStart };
