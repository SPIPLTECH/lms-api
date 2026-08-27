const cron = require("node-cron");

const adminIntelligenceService = require("../services/adminIntelligence.service");
const {
  REPORT_TYPE,
  WEEKLY_REPORT_CRON,
  MONTHLY_REPORT_CRON,
  QUARTERLY_REPORT_CRON,
  ANNUAL_REPORT_CRON,
  SEMESTER_REPORT_CRON,
} = require("../constants");

/**
 * The five Executive Report periods — one cron each, all building the same
 * institution-wide ExecutiveReport via buildAndPersistReport. SEMESTER has
 * no real Semester model to derive a boundary from (see schema.prisma doc)
 * so it uses this agent's own configurable Jan 1 / Jul 1 approximation.
 */
const SCHEDULE = [
  [REPORT_TYPE.WEEKLY, WEEKLY_REPORT_CRON],
  [REPORT_TYPE.MONTHLY, MONTHLY_REPORT_CRON],
  [REPORT_TYPE.QUARTERLY, QUARTERLY_REPORT_CRON],
  [REPORT_TYPE.ANNUAL, ANNUAL_REPORT_CRON],
  [REPORT_TYPE.SEMESTER, SEMESTER_REPORT_CRON],
];

const start = () => {
  for (const [reportType, cronExpression] of SCHEDULE) {
    cron.schedule(cronExpression, () => {
      adminIntelligenceService.buildAndPersistReport(reportType).catch((error) => {
        console.error(`[admin-intelligence:reportScheduler] failed to generate ${reportType} report:`, error);
      });
    });
    console.log(`[admin-intelligence:reportScheduler] scheduled ${reportType} report (${cronExpression})`);
  }
};

module.exports = { start };
