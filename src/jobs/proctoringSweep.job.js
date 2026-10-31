const cron = require("node-cron");

const { isProctoringAvailable } = require("../config/proctoring");

/**
 * Closes proctored exams past their deadline and abandons readiness checks left
 * open, once a minute. Not started at all while proctoring is off, so the LMS runs
 * exactly as it did. A student's own request closes an overdue exam too; this covers
 * the student who has gone.
 *
 * PROCTORING_SWEEP_CRON overrides the schedule; "off" disables the job.
 */
const DEFAULT_SCHEDULE = "* * * * *";

function startProctoringSweepJob() {
  if (!isProctoringAvailable()) return null;
  const schedule = (process.env.PROCTORING_SWEEP_CRON || DEFAULT_SCHEDULE).trim();
  if (schedule.toLowerCase() === "off") return null;
  if (!cron.validate(schedule)) {
    console.warn(`[proctoring-sweep] invalid PROCTORING_SWEEP_CRON "${schedule}" — job not started`);
    return null;
  }

  // Loaded only when proctoring is on.
  const { sweepAttempts } = require("../modules/proctoring/attempt.service");
  let running = false;
  return cron.schedule(schedule, async () => {
    if (running) return;
    running = true;
    try {
      const { expired, abandoned } = await sweepAttempts();
      if (expired || abandoned) {
        console.log(`[proctoring-sweep] closed ${expired} overdue exam(s), abandoned ${abandoned} readiness check(s)`);
      }
    } catch (error) {
      console.warn("[proctoring-sweep] run failed:", error?.message);
    } finally {
      running = false;
    }
  });
}

module.exports = { startProctoringSweepJob };
