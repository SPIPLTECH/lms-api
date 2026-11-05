const cron = require("node-cron");
const prisma = require("../config/database");

/**
 * Periodically audits expired enrollments.
 *
 * Request-time validation (in progress.service, quiz.service, etc.) is the primary
 * gatekeeper enforcing real-time expiration without waiting for any cron run.
 * This background job runs periodically to audit, log, and report active/expired counts.
 *
 * ENROLLMENT_EXPIRATION_CRON overrides the schedule; "off" disables the job.
 */
const DEFAULT_SCHEDULE = "0 * * * *"; // Every hour

async function auditExpiredEnrollments() {
  const now = new Date();
  try {
    const expiredCount = await prisma.enrollment.count({
      where: {
        expiresAt: {
          lte: now,
        },
      },
    });

    return { expiredCount, checkedAt: now };
  } catch (error) {
    console.warn("[enrollment-expiration] audit failed:", error?.message);
    return null;
  }
}

let scheduledTask = null;

function startEnrollmentExpirationJob() {
  const schedule = (process.env.ENROLLMENT_EXPIRATION_CRON || DEFAULT_SCHEDULE).trim();
  if (schedule.toLowerCase() === "off") return null;
  if (!cron.validate(schedule)) {
    console.warn(
      `[enrollment-expiration] invalid ENROLLMENT_EXPIRATION_CRON "${schedule}" — job not started`
    );
    return null;
  }

  scheduledTask = cron.schedule(schedule, async () => {
    const result = await auditExpiredEnrollments();
    if (result && result.expiredCount > 0) {
      console.log(`[enrollment-expiration] found ${result.expiredCount} expired enrollment(s) as of ${result.checkedAt.toISOString()}`);
    }
  });

  return scheduledTask;
}

function stopEnrollmentExpirationJob() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}

module.exports = {
  startEnrollmentExpirationJob,
  stopEnrollmentExpirationJob,
  auditExpiredEnrollments,
};
