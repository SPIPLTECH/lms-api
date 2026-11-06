const { spawn: nodeSpawn } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * lms-api starts and supervises its Python AI process (the `ai/` folder), which listens on
 * a loopback port and is reached through AI_SERVICE_URL. Ported from ProctorGuard.
 *
 *   - An unexpected exit restarts after a backoff (1 s, doubling, capped at 30 s; starts over
 *     after a 60 s run). More than 5 restarts in 10 minutes is a crash loop: it stops and says so.
 *   - A process that fails 3 health checks in a row is treated as hung and replaced.
 *   - It is given this process's pid, so it exits however lms-api ends, even if killed.
 *
 * Running exams never depend on this: while the AI is down they continue and are flagged, and
 * no new exam can begin. A URL that is not on this machine is left alone, so the AI
 * can move to its own server with no code change.
 */

const BACKOFF_INITIAL_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_RESET_AFTER_MS = 60_000;
const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 10 * 60_000;
const HEALTH_INTERVAL_MS = 10_000;
const UNHEALTHY_AFTER = 3;
const READY_POLL_MS = 500;
const READY_TIMEOUT_MS = 30_000;

const SETUP_HINT = "Run `npm run ai:setup` once, then restart the API.";
const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]", "::1"];

// An allow-list: the AI gets what Python needs and its own settings, and nothing else, so the
// database URL, JWT secrets, evidence keys and every API key stay out of its environment.
const INHERITED = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|LANG|LC_.*|PYTHON[A-Z]*|AI_(HOST|PORT|MODEL_PATH|MAX_IMAGE_BYTES|MAX_PIXELS|FACE_SCORE_THRESHOLD|NUM_THREADS|BUSY_TIMEOUT_SECONDS|WORKERS|OBJECTS_ENABLED|OBJECT_MODEL_PATH|OBJECT_SCORE_THRESHOLD|OBJECT_LABELS|IDENTITY_ENABLED|IDENTITY_MODEL_PATH|ALLOW_NON_LOOPBACK))$/i;

function resolveAiLaunch(config, apiRoot, platform, baseEnv, parentPid) {
  if (!config.url || !config.token) return { skip: "NOT_CONFIGURED" };
  if (!config.managed) return { skip: "DISABLED" };
  const url = new URL(config.url);
  if (!LOOPBACK_HOSTS.includes(url.hostname)) return { skip: "EXTERNAL" };

  const aiRoot = path.join(apiRoot, "ai");
  const inherited = Object.fromEntries(Object.entries(baseEnv).filter(([key]) => INHERITED.test(key)));
  return {
    command: config.python || (platform === "win32" ? path.join(aiRoot, ".venv", "Scripts", "python.exe") : path.join(aiRoot, ".venv", "bin", "python")),
    args: ["-m", "proctor_ai", "--parent-pid", String(parentPid)],
    cwd: aiRoot,
    env: {
      ...inherited,
      AI_SERVICE_TOKEN: config.token,
      AI_HOST: url.hostname.replace(/^\[|\]$/g, ""),
      AI_PORT: url.port || (url.protocol === "https:" ? "443" : "80"),
    },
  };
}

class AiProcessManager {
  constructor(launchPlan, deps) {
    this.launchPlan = launchPlan;
    this.deps = deps;
    this.child = null;
    this.startedAt = 0;
    this.restarts = [];
    this.consecutiveFailures = 0;
    this.failedChecks = 0;
    this.checking = false;
    this.stopped = false;
    this.restartTimer = null;
    this.healthTimer = null;
  }

  start() {
    this.launch();
    this.healthTimer = setInterval(() => this.healthRound(), HEALTH_INTERVAL_MS);
    this.healthTimer.unref?.();
  }

  stop() {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.child?.kill();
  }

  async waitUntilHealthy(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await this.deps.health()) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    }
  }

  launch() {
    const { command, args, cwd, env } = this.launchPlan;
    this.failedChecks = 0;
    this.startedAt = Date.now();
    const child = this.deps.spawn(command, args, { cwd, env, stdio: ["ignore", "inherit", "inherit"], windowsHide: true });
    this.child = child;
    child.on("error", (error) => {
      this.deps.warn(`[proctoring-ai] could not run the AI process: ${error.message}`);
      // A process that never started emits no exit event.
      if (child.pid === undefined) this.onExit(child, "spawn error");
    });
    child.on("exit", (code, signal) => this.onExit(child, `exit ${code ?? signal}`));
  }

  onExit(child, reason) {
    if (this.child !== child) return;
    this.child = null;
    if (this.stopped) return;

    const now = Date.now();
    if (now - this.startedAt >= BACKOFF_RESET_AFTER_MS) this.consecutiveFailures = 0;
    this.restarts = this.restarts.filter((time) => now - time < RESTART_WINDOW_MS);
    if (this.restarts.length >= MAX_RESTARTS) {
      this.deps.warn(`[proctoring-ai] WARNING: the AI process is in a crash loop (${reason}; ${this.restarts.length} restarts in 10 minutes). It will not be restarted. Running exams continue and are flagged; no new exam can begin. Fix it and restart the API.`);
      if (this.healthTimer) clearInterval(this.healthTimer);
      return;
    }
    this.restarts.push(now);
    this.consecutiveFailures += 1;
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_INITIAL_MS * 2 ** (this.consecutiveFailures - 1));
    this.deps.warn(`[proctoring-ai] the AI process stopped (${reason}); restarting in ${delay} ms.`);
    this.restartTimer = setTimeout(() => this.launch(), delay);
    this.restartTimer.unref?.();
  }

  async healthRound() {
    if (!this.child || this.checking) return;
    this.checking = true;
    try {
      if (await this.deps.health()) {
        this.failedChecks = 0;
        return;
      }
      this.failedChecks += 1;
      if (this.failedChecks >= UNHEALTHY_AFTER && this.child) {
        this.deps.warn(`[proctoring-ai] the AI process did not answer ${UNHEALTHY_AFTER} health checks; replacing it.`);
        this.child.kill();
      }
    } finally {
      this.checking = false;
    }
  }
}

/**
 * Brings the AI up and waits for it to answer. Returns the manager when this API owns the
 * process, or null when there is nothing to manage: not configured, on another server,
 * already running, or Python not set up. Never throws.
 */
async function startManagedAi({ plan, health, exists = fs.existsSync, spawn = nodeSpawn, warn = console.warn, info = console.log }) {
  if (plan.skip) return null;
  if (!exists(plan.command)) {
    warn(`[proctoring-ai] WARNING: the AI Python environment is missing. No exam can begin until it is there. ${SETUP_HINT}`);
    return null;
  }
  if (await health()) {
    info("[proctoring-ai] an AI process is already running on the configured port; using it.");
    return null;
  }
  const manager = new AiProcessManager(plan, { spawn, health, warn, info });
  manager.start();
  if (await manager.waitUntilHealthy(READY_TIMEOUT_MS)) info("[proctoring-ai] AI process is ready.");
  return manager;
}

module.exports = { AiProcessManager, resolveAiLaunch, startManagedAi };
