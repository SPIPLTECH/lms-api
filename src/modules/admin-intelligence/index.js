const service = require("./adminIntelligence.service");

/** Admin Intelligence agent — public surface. */
module.exports = {
  getDashboard: service.getDashboard,

  get router() {
    return require("./adminIntelligence.routes");
  },
};
