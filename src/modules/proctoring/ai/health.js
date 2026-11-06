const { isIdentityMatchingEnabled } = require("../../../config/proctoring");
const { isAiConfigured } = require("./faceDetection.adapter");

/**
 * Whether the AI can do its job. Exams must not begin without it. The answer is cached
 * briefly so a rush of students at the start does not become a rush of health calls.
 * No URLs, tokens, paths or hashes ever leave this module.
 */

const CACHE_MS = 5000;
const CHECK_TIMEOUT_MS = 2000;

let cached = null;

const resetAiHealthCache = () => {
  cached = null;
};

async function getAiServiceHealth(env = process.env) {
  const down = { configured: isAiConfigured(env), reachable: false, faceModelLoaded: false, objectModelLoaded: false, identityModelLoaded: false, workers: null };
  if (!down.configured) return down;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(new URL("/v1/health", env.AI_SERVICE_URL), {
      headers: { Authorization: `Bearer ${env.AI_SERVICE_TOKEN}` },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    return {
      configured: true,
      reachable: response.ok,
      faceModelLoaded: response.ok && body.modelLoaded === true,
      objectModelLoaded: response.ok && body.objectModelLoaded === true,
      identityModelLoaded: response.ok && body.identityModelLoaded === true,
      workers: response.ok && typeof body.workers === "number" ? body.workers : null,
    };
  } catch {
    return down;
  } finally {
    clearTimeout(timer);
  }
}

const isReady = (health, env) =>
  health.reachable && health.faceModelLoaded && health.objectModelLoaded && (!isIdentityMatchingEnabled(env) || health.identityModelLoaded);

async function isAiHealthy(env = process.env) {
  if (cached && Date.now() - cached.at < CACHE_MS) return isReady(cached.health, env);
  const health = await getAiServiceHealth(env);
  cached = { at: Date.now(), health };
  return isReady(health, env);
}

const REPEAT_MS = 60_000;
const outage = { failing: 0, lastWarnAt: null };

/** Makes an outage loud in the log: at once, then at most once a minute, and on recovery. */
function noteAnalysisOutcome(result) {
  if (result.status === "UNAVAILABLE") {
    outage.failing += 1;
    const now = Date.now();
    if (outage.lastWarnAt === null || now - outage.lastWarnAt >= REPEAT_MS) {
      outage.lastWarnAt = now;
      console.warn(`[proctoring-ai] WARNING: AI unavailable (${result.errorCode ?? "unknown"}): ${outage.failing} frame(s) not analysed so far. Exams continue and are flagged.`);
    }
  } else if (result.status === "OK" && outage.failing > 0) {
    console.log(`[proctoring-ai] AI recovered; ${outage.failing} frame(s) were not analysed during the outage.`);
    outage.failing = 0;
    outage.lastWarnAt = null;
  }
}

module.exports = { getAiServiceHealth, isAiHealthy, noteAnalysisOutcome, resetAiHealthCache };
