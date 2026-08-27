const cron = require("node-cron");

const adminIntelligenceService = require("../services/adminIntelligence.service");
const { DAILY_SWEEP_CRON } = require("../constants");

/**
 * The only honest trigger for "Enrollment Changes", "Semester Starts/Ends",
 * "Revenue Changes", "Infrastructure Changes", and "System Events" — none
 * of these have a real event anywhere in this codebase (confirmed across
 * all 10 peer modules' eventNames.js), so a daily full recompute is how
 * this agent stays correct for them, same "events accelerate freshness, a
 * scheduled sweep guarantees correctness" principle every agent in this
 * series follows. Scheduled after Analytics' own 03:00 platform sweep so
 * this agent reads that day's freshly-computed KPIs.
 */
const runOnce = () => adminIntelligenceService.generateInsights("daily-sweep");

const start = () => {
  cron.schedule(DAILY_SWEEP_CRON, () => {
    runOnce().catch((error) => console.error("[admin-intelligence:dailySweep] run failed:", error));
  });

  console.log(`[admin-intelligence:dailySweep] scheduled (${DAILY_SWEEP_CRON})`);
};

module.exports = { start, runOnce };
