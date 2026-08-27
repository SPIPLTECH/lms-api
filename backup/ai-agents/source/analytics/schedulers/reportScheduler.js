const cron = require("node-cron");

const analyticsService = require("../services/analytics.service");
const { REPORT_TYPE, WEEKLY_REPORT_CRON, MONTHLY_REPORT_CRON, QUARTERLY_REPORT_CRON, ANNUAL_REPORT_CRON } = require("../constants");

/** The four "Administrative Reports" periods from the spec — one cron each, all building the same PLATFORM-scoped report via buildAndPersistReport. */
const SCHEDULE = [
  [REPORT_TYPE.WEEKLY, WEEKLY_REPORT_CRON],
  [REPORT_TYPE.MONTHLY, MONTHLY_REPORT_CRON],
  [REPORT_TYPE.QUARTERLY, QUARTERLY_REPORT_CRON],
  [REPORT_TYPE.ANNUAL, ANNUAL_REPORT_CRON],
];

const start = () => {
  for (const [reportType, cronExpression] of SCHEDULE) {
    cron.schedule(cronExpression, () => {
      analyticsService.buildAndPersistReport(reportType).catch((error) => {
        console.error(`[analytics:reportScheduler] failed to generate ${reportType} report:`, error);
      });
    });
    console.log(`[analytics:reportScheduler] scheduled ${reportType} report (${cronExpression})`);
  }
};

module.exports = { start };
