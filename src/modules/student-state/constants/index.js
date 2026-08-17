const { EVENT_TYPES } = require("../../observation");

const scoreWeights = require("./scoreWeights.constants");
const thresholds = require("./thresholds.constants");
const defaults = require("./defaultDomainState.constants");
const entryPhase = require("./entryPhase.constants");

const RISK_LEVELS = Object.freeze({ LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" });
const TRENDS = Object.freeze({ IMPROVING: "IMPROVING", DECLINING: "DECLINING", STABLE: "STABLE" });
const SPEEDS = Object.freeze({ SLOW: "SLOW", NORMAL: "NORMAL", FAST: "FAST" });

module.exports = {
  EVENT_TYPES,
  RISK_LEVELS,
  TRENDS,
  SPEEDS,
  ...scoreWeights,
  ...thresholds,
  ...defaults,
  ...entryPhase,
};
