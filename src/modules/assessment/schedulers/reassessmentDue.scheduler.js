const cron = require("node-cron");

const reassessmentRepository = require("../repositories/reassessmentPlan.repository");

const CRON_EXPRESSION = "*/30 * * * *"; // every 30 minutes

/**
 * Flips PENDING reassessment plans to DUE once their scheduled time has
 * passed. This is what makes ReassessmentStatus.DUE mean something —
 * without it, "scheduled reassessments" would just sit as PENDING forever
 * with no signal that action is actually needed now.
 */
const runOnce = async () => {
  const now = new Date();
  const duePlans = await reassessmentRepository.findDuePlans(now);

  let updated = 0;
  for (const plan of duePlans) {
    try {
      await reassessmentRepository.markDue(plan.id);
      updated += 1;
    } catch (error) {
      console.error(`[assessment:reassessmentDue] failed to mark plan ${plan.id} due:`, error.message);
    }
  }

  console.log(`[assessment:reassessmentDue] marked ${updated}/${duePlans.length} plans due`);
  return { updated, total: duePlans.length };
};

const start = () => {
  cron.schedule(CRON_EXPRESSION, () => {
    runOnce().catch((error) => {
      console.error("[assessment:reassessmentDue] run failed:", error);
    });
  });

  console.log(`[assessment:reassessmentDue] scheduled (${CRON_EXPRESSION})`);
};

module.exports = { start, runOnce };
