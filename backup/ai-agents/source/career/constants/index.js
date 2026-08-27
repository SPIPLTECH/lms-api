const enums = require("./enums.constants");
const thresholds = require("./thresholds.constants");
const { INDUSTRY_ROLE_SEED_DATA } = require("./industryRoles.seed");

module.exports = {
  ...enums,
  ...thresholds,
  INDUSTRY_ROLE_SEED_DATA,
};
