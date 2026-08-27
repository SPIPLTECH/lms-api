const enums = require("./enums.constants");
const thresholds = require("./thresholds.constants");

const PERIOD_DAYS_BY_REPORT_TYPE = Object.freeze({
  [enums.REPORT_TYPE.WEEKLY]: thresholds.WEEKLY_PERIOD_DAYS,
  [enums.REPORT_TYPE.MONTHLY]: thresholds.MONTHLY_PERIOD_DAYS,
  [enums.REPORT_TYPE.QUARTERLY]: thresholds.QUARTERLY_PERIOD_DAYS,
  [enums.REPORT_TYPE.ANNUAL]: thresholds.ANNUAL_PERIOD_DAYS,
  [enums.REPORT_TYPE.SEMESTER]: thresholds.SEMESTER_PERIOD_DAYS,
});

module.exports = {
  ...enums,
  ...thresholds,
  PERIOD_DAYS_BY_REPORT_TYPE,
};
