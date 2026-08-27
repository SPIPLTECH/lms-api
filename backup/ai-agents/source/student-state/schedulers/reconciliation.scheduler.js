const cron = require("node-cron");

const studentStateRepository = require("../repositories/studentState.repository");
const studentStateService = require("../services/studentState.service");

// Risk fields decay with time, not just with new events (a student going
// silent generates no event to trigger a recompute). Bounded to students
// active in the last 45 days — anyone quieter than that has already
// saturated at max inactivity risk and doesn't need re-checking hourly.
const RECONCILIATION_LOOKBACK_DAYS = 45;
const CRON_EXPRESSION = "0 * * * *"; // top of every hour

const runOnce = async () => {
  const since = new Date(Date.now() - RECONCILIATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const studentIds = await studentStateRepository.findRecentlyActiveStudentIds(since);

  let refreshed = 0;
  let failed = 0;

  for (const studentId of studentIds) {
    try {
      await studentStateService.refreshInactivityRisk(studentId);
      refreshed += 1;
    } catch (error) {
      failed += 1;
      console.error(`[student-state:reconciliation] failed for ${studentId}:`, error.message);
    }
  }

  console.log(`[student-state:reconciliation] refreshed=${refreshed} failed=${failed} of ${studentIds.length}`);
  return { refreshed, failed, total: studentIds.length };
};

/** Registers the hourly cron job. Call once at process startup. */
const start = () => {
  cron.schedule(CRON_EXPRESSION, () => {
    runOnce().catch((error) => {
      console.error("[student-state:reconciliation] run failed:", error);
    });
  });

  console.log(`[student-state:reconciliation] scheduled (${CRON_EXPRESSION})`);
};

module.exports = { start, runOnce };
