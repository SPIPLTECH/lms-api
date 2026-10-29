const service = require("./analytics.service");

/**
 * Analytics agent — public surface (getter names kept from the original:
 * Admin Intelligence consumes getPlatformKPIs / getCourseKPIsBatch). Getters
 * resolve to null / [] when there is no data and never throw.
 */
module.exports = {
  computeSnapshots: service.computeSnapshots,
  ensureToday: service.ensureToday,
  getPlatformKPIs: service.getPlatformKPIs,
  getCourseKPIsBatch: service.getCourseKPIsBatch,
  getSnapshots: service.getSnapshots,
  PLATFORM_SCOPE_ID: service.PLATFORM_SCOPE_ID,

  get router() {
    return require("./analytics.routes");
  },
};
