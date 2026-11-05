/**
 * Liveness and readiness for a container platform (Render, Docker).
 *
 *   GET /healthz  the process is up. Touches nothing, so a slow database or a restarting AI
 *                 never makes the platform restart the whole API.
 *   GET /readyz   the database answers and, while proctoring is on, exam monitoring can run
 *                 (the same check that decides whether an exam may start). 503 otherwise.
 *
 * The answers carry no URLs, hosts, errors or versions.
 */

const DEFAULT_TIMEOUT_MS = 2000;

const within = (promise, ms) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  return Promise.race([Promise.resolve().then(() => promise), timeout]).finally(() => clearTimeout(timer));
};

function createHealthChecks({ pingDatabase, proctoringAvailable, monitoringAvailable, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  async function readiness() {
    const database = await within(pingDatabase(), timeoutMs).then(
      () => "ok",
      () => "unavailable"
    );
    let proctoring = "off";
    if (proctoringAvailable()) {
      const monitoring = await within(monitoringAvailable(), timeoutMs).catch(() => false);
      proctoring = monitoring ? "ready" : "unavailable";
    }
    return { ready: database === "ok" && proctoring !== "unavailable", database, proctoring };
  }
  return { readiness };
}

/** The checks the API uses. Proctoring modules are loaded only while the feature is on. */
function defaultHealthChecks() {
  const prisma = require("../config/database");
  const { isProctoringAvailable } = require("../config/proctoring");
  return createHealthChecks({
    pingDatabase: () => prisma.$queryRaw`SELECT 1`,
    proctoringAvailable: isProctoringAvailable,
    monitoringAvailable: () => require("../modules/proctoring/attempt.service").isMonitoringAvailable(),
  });
}

module.exports = { createHealthChecks, defaultHealthChecks };
