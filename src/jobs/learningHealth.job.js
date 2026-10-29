const cron = require("node-cron");

const learningHealth = require("../modules/learning-health");
const { DEFAULT_SWEEP_CRON } = require("../modules/learning-health/learningHealth.config");

/**
 * Recomputes Learning Health for every active enrolment once a night.
 *
 * The write-path trigger only fires when a learner DOES something, so this
 * sweep is what lets inactivity count: a learner who has gone quiet produces
 * no writes, and their risk would otherwise never move. Runs course by
 * course with batched queries (a constant number per course, not per
 * learner). Idempotent upserts, so a second instance running it too is
 * wasteful but harmless.
 *
 * LEARNING_HEALTH_CRON overrides the schedule; "off" disables the job.
 */
function startLearningHealthJob() {
  const schedule = (process.env.LEARNING_HEALTH_CRON || DEFAULT_SWEEP_CRON).trim();
  if (schedule.toLowerCase() === "off") return null;
  if (!cron.validate(schedule)) {
    console.warn(`[learning-health] invalid LEARNING_HEALTH_CRON "${schedule}" — job not started`);
    return null;
  }

  return cron.schedule(schedule, async () => {
    try {
      const { courses, students, failed } = await learningHealth.sweepAll();
      console.log(
        `[learning-health] nightly sweep: ${students} learner(s) across ${courses} course(s)` +
          (failed ? `, ${failed} course(s) failed` : "")
      );
    } catch (error) {
      console.warn("[learning-health] nightly sweep failed:", error?.message);
    }
  });
}

module.exports = { startLearningHealthJob };
