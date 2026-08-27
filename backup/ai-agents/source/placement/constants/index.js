const enums = require("./enums.constants");
const thresholds = require("./thresholds.constants");
const { COMPANY_SEED_DATA } = require("./companies.seed");
const { JOB_SEED_DATA, INTERNSHIP_SEED_DATA, PLACEMENT_DRIVE_SEED_DATA } = require("./opportunities.seed");

module.exports = {
  ...enums,
  ...thresholds,
  COMPANY_SEED_DATA,
  JOB_SEED_DATA,
  INTERNSHIP_SEED_DATA,
  PLACEMENT_DRIVE_SEED_DATA,
};
