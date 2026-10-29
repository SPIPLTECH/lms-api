const service = require("./motivation.service");
const { subscribe, MOTIVATION_EVENT_NAMES } = require("./motivation.events");

/**
 * Motivation agent — public surface. Other modules and agents use only this.
 * Getters resolve to null / [] when there is no data and never throw.
 */
module.exports = {
  bootstrap: service.bootstrap,
  scheduleRecompute: service.scheduleRecompute,

  // Cross-agent reads (getStreak / getBatchStreaks: original names)
  getStreak: service.getStreak,
  getActiveNudges: service.getActiveNudges,
  getBatchStreaks: service.getBatchStreaks,

  subscribe,
  MOTIVATION_EVENT_NAMES,

  get router() {
    return require("./motivation.routes");
  },
};
