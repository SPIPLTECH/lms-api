const service = require("./studyPlan.service");
const { subscribe, STUDY_PLAN_EVENT_NAMES } = require("./studyPlan.events");

/**
 * Learning Path agent (study plan) — public surface. Getters resolve to null
 * / [] when there is no data and never throw.
 */
module.exports = {
  bootstrap: service.bootstrap,
  scheduleRecompute: service.scheduleRecompute,

  getPlan: service.getPlan,
  getBatchPlans: service.getBatchPlans,

  subscribe,
  STUDY_PLAN_EVENT_NAMES,

  get router() {
    return require("./studyPlan.routes");
  },
};
