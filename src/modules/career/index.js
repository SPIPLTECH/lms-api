const service = require("./career.service");

/**
 * Career Guidance agent — public surface. Getters resolve to null when there
 * is no data and never throw.
 */
module.exports = {
  getFullState: service.getFullState,
  getGoalSummary: service.getGoalSummary,
  listRoles: service.listRoles,

  get router() {
    return require("./career.routes");
  },
};
