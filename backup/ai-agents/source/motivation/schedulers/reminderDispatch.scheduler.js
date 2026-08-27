const cron = require("node-cron");

const reminderRepository = require("../repositories/reminderSchedule.repository");
const actionRepository = require("../repositories/motivationAction.repository");
const analyticsRepository = require("../repositories/motivationAnalytics.repository");
const { computeNextRunAt } = require("../services/domain/reminderScheduler");
const { MOTIVATION_PRIORITY, DEFAULT_EXPIRY_HOURS } = require("../constants");

const CRON_EXPRESSION = "*/15 * * * *"; // every 15 minutes
const HOUR_MS = 3600 * 1000;

const REMINDER_MESSAGES = {
  DAILY_REMINDER: "Time for today's learning session.",
};

/**
 * The actual reminder-scheduling logic: finds ReminderSchedule rows whose
 * nextRunAt has passed, generates the corresponding MotivationAction
 * (DAILY_REMINDER is schedule-driven, unlike every other action type which
 * comes from a context detector — see services/domain/detectors/index.js),
 * then advances nextRunAt by the schedule's own cadence.
 */
const runOnce = async () => {
  const now = new Date();
  const due = await reminderRepository.findDue(now);

  let dispatched = 0;
  for (const schedule of due) {
    try {
      const expiryHours = DEFAULT_EXPIRY_HOURS[schedule.reminderType];
      await actionRepository.upsertCandidate(
        schedule.studentId,
        {
          type: schedule.reminderType,
          dedupeKey: `${schedule.reminderType}:scheduled`,
          priority: MOTIVATION_PRIORITY.LOW,
          triggerReason: REMINDER_MESSAGES[schedule.reminderType] || "Scheduled reminder.",
          confidence: 70,
          recommendedAt: now,
        },
        expiryHours ? new Date(now.getTime() + expiryHours * HOUR_MS) : null
      );
      await analyticsRepository.increment(schedule.reminderType, "generatedCount", now);

      const nextRunAt = computeNextRunAt(schedule.cadence, schedule.preferredHour ?? 18, now, schedule.nextRunAt);
      await reminderRepository.markRun(schedule.id, { lastRunAt: now, nextRunAt });
      dispatched += 1;
    } catch (error) {
      console.error(`[motivation:reminderDispatch] failed to dispatch schedule ${schedule.id}:`, error.message);
    }
  }

  console.log(`[motivation:reminderDispatch] dispatched ${dispatched}/${due.length} reminders`);
  return { dispatched, total: due.length };
};

const start = () => {
  cron.schedule(CRON_EXPRESSION, () => {
    runOnce().catch((error) => {
      console.error("[motivation:reminderDispatch] run failed:", error);
    });
  });

  console.log(`[motivation:reminderDispatch] scheduled (${CRON_EXPRESSION})`);
};

module.exports = { start, runOnce };
