const cron = require("node-cron");

const sessionService = require("../modules/sessions/session.service");

/**
 * Moves stale ACTIVE sessions and playback leases to EXPIRED every five
 * minutes, so the tables reflect reality and sockets of expired sessions are
 * closed. Correctness does not depend on it: every request, sign-in and
 * playback start already expires stale rows itself before deciding. Safe to
 * run on several instances at once — every update is conditional on ACTIVE.
 *
 * SESSION_CLEANUP_CRON overrides the schedule; "off" disables the job.
 */
const DEFAULT_SCHEDULE = "*/5 * * * *";

function startSessionCleanupJob() {
  const schedule = (process.env.SESSION_CLEANUP_CRON || DEFAULT_SCHEDULE).trim();
  if (schedule.toLowerCase() === "off") return null;
  if (!cron.validate(schedule)) {
    console.warn(`[session-cleanup] invalid SESSION_CLEANUP_CRON "${schedule}" — job not started`);
    return null;
  }

  return cron.schedule(schedule, async () => {
    try {
      const { sessions, leases } = await sessionService.expireAllStale();
      if (sessions || leases) {
        console.log(`[session-cleanup] expired ${sessions} session(s), ${leases} playback lease(s)`);
      }
    } catch (error) {
      console.warn("[session-cleanup] run failed:", error?.message);
    }
  });
}

module.exports = { startSessionCleanupJob };
