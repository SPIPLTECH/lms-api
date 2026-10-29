const cron = require("node-cron");

const analytics = require("../modules/analytics");

/**
 * Takes the day's Analytics snapshot (course + platform metrics) once a night,
 * after the Learning Health sweep (02:30) so risk counts are fresh. A read
 * computes the day's snapshot too if this has not run, so trends never have
 * a hole just because the server was down at night.
 *
 * ANALYTICS_CRON overrides the schedule; "off" disables the job.
 */
const DEFAULT_SCHEDULE = "15 3 * * *";

function startAnalyticsJob() {
  const schedule = (process.env.ANALYTICS_CRON || DEFAULT_SCHEDULE).trim();
  if (schedule.toLowerCase() === "off") return null;
  if (!cron.validate(schedule)) {
    console.warn(`[analytics] invalid ANALYTICS_CRON "${schedule}" — job not started`);
    return null;
  }

  return cron.schedule(schedule, async () => {
    try {
      const { courses } = await analytics.computeSnapshots();
      console.log(`[analytics] nightly snapshot: platform + ${courses} course(s)`);
    } catch (error) {
      console.warn("[analytics] nightly snapshot failed:", error?.message);
    }
  });
}

module.exports = { startAnalyticsJob };
