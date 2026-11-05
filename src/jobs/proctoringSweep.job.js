const path = require("path");
const cron = require("node-cron");

const { isProctoringAvailable, isTrue } = require("../config/proctoring");

/**
 * Everything proctoring runs in the background. None of it starts while the feature is off,
 * and its modules are not even loaded then, so the LMS runs exactly as it did.
 *
 *   every minute     close overdue exams, abandon stale readiness checks, write counters
 *   every 20 s       notice stopped uploads; retry writes that must not be lost
 *   every 15 min     retention sweep, and reminders for reviews past 7 days
 *   at start         recover running attempts, and start and supervise the Python AI
 *
 * PROCTORING_SWEEP_CRON and PROCTORING_RETENTION_CRON override the schedules; "off" disables one.
 * AI_MANAGED=false leaves the AI to whatever else runs it.
 */
const DEFAULT_SWEEP = "* * * * *";
const DEFAULT_RETENTION = "*/15 * * * *";
const WATCHDOG_MS = 20 * 1000;

function schedule(name, value, fallback, work) {
  const expression = (value || fallback).trim();
  if (expression.toLowerCase() === "off") return null;
  if (!cron.validate(expression)) {
    console.warn(`[proctoring] invalid ${name} schedule "${expression}" — job not started`);
    return null;
  }
  let running = false;
  return cron.schedule(expression, async () => {
    if (running) return;
    running = true;
    try {
      await work();
    } catch (error) {
      console.warn(`[proctoring] ${name} failed:`, error?.message);
    } finally {
      running = false;
    }
  });
}

function startProctoringJobs() {
  if (!isProctoringAvailable()) return null;

  const { sweepAttempts } = require("../modules/proctoring/attempt.service");
  const monitor = require("../modules/proctoring/monitor.service");
  const { retentionSweep } = require("../modules/proctoring/retention.service");
  const { reviewReminderSweep } = require("../modules/proctoring/review.service");
  const { getAiServiceHealth } = require("../modules/proctoring/ai/health");
  const { resolveAiLaunch, startManagedAi } = require("../modules/proctoring/ai/processManager");

  const plan = resolveAiLaunch(
    {
      url: process.env.AI_SERVICE_URL || null,
      token: process.env.AI_SERVICE_TOKEN || null,
      managed: process.env.AI_MANAGED === undefined || process.env.AI_MANAGED === "" || isTrue(process.env.AI_MANAGED),
      python: process.env.AI_PYTHON || null,
    },
    path.resolve(__dirname, "../.."),
    process.platform,
    process.env,
    process.pid
  );
  const health = async () => (await getAiServiceHealth()).reachable;
  const aiManager = startManagedAi({ plan, health }).catch((error) => {
    console.warn("[proctoring-ai] could not start:", error?.message);
    return null;
  });

  monitor.recoverAfterRestart().catch((error) => console.warn("[proctoring] recovery failed:", error?.message));

  const watchdog = setInterval(() => monitor.watchdogTick().catch((error) => console.warn("[proctoring] watchdog failed:", error?.message)), WATCHDOG_MS);
  watchdog.unref?.();

  const tasks = [
    schedule("PROCTORING_SWEEP_CRON", process.env.PROCTORING_SWEEP_CRON, DEFAULT_SWEEP, async () => {
      const { expired, abandoned } = await sweepAttempts();
      if (expired || abandoned) console.log(`[proctoring] closed ${expired} overdue exam(s), abandoned ${abandoned} readiness check(s)`);
      await monitor.flushCounters();
    }),
    schedule("PROCTORING_RETENTION_CRON", process.env.PROCTORING_RETENTION_CRON, DEFAULT_RETENTION, async () => {
      await retentionSweep();
      await reviewReminderSweep();
    }),
  ];
  running = { aiManager, watchdog, tasks };
  return true;
}

let running = null;

/**
 * For a clean shutdown: stops the schedules and the watchdog, saves what is still waiting in
 * memory (events, kept-photo rows, counters, photos still being copied to the store), and stops
 * the AI process. Exams in progress are recovered from the database by the next start.
 */
async function stopProctoringJobs({ waitMs = 10 * 1000 } = {}) {
  if (!running) return;
  const { aiManager, watchdog, tasks } = running;
  running = null;
  clearInterval(watchdog);
  for (const task of tasks) task?.stop();

  const monitor = require("../modules/proctoring/monitor.service");
  const evidence = require("../modules/proctoring/evidence.service");
  const { analysisQueue } = require("../modules/proctoring/aiQueue");
  const settle = (promise) => {
    let timer;
    return Promise.race([promise, new Promise((resolve) => { timer = setTimeout(resolve, waitMs); })]).finally(() => clearTimeout(timer));
  };
  // Frames already with the AI finish first, so their results and warnings are written too.
  await settle(analysisQueue.drain());
  await monitor.flushBuffers();
  await monitor.flushCounters();
  await settle(evidence.drain());

  (await aiManager)?.stop();
}

module.exports = { startProctoringJobs, stopProctoringJobs };
