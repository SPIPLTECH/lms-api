/**
 * Creates .env.proctoring-local with fresh random secrets. Never overwrites an
 * existing file and prints no secret. The file is git-ignored by the `.env.*` rule.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { LOCAL_ENV, LOCAL_ROOT } = require("./env");

if (fs.existsSync(LOCAL_ENV)) {
  console.log("[proctoring-local] .env.proctoring-local already exists; left unchanged.");
  process.exit(0);
}

const secret = (bytes = 32) => crypto.randomBytes(bytes).toString("hex");
const password = secret(16);
const forward = (p) => p.replace(/\\/g, "/");

const lines = {
  NODE_ENV: "development",
  PORT: "5000",
  HOST: "127.0.0.1",
  DATABASE_URL: `postgresql://lmslocal:${password}@127.0.0.1:54361/lms_proctoring_local`,
  TEST_DATABASE_URL: `postgresql://lmslocal:${password}@127.0.0.1:54361/lms_proctoring_test`,
  JWT_SECRET: secret(),
  JWT_ACCESS_SECRET: secret(),
  JWT_REFRESH_SECRET: secret(),
  FRONTEND_URL: "http://localhost:3000",
  ENABLE_SERVER_TIMING: "true",
  API_TIMING_LOG_MS: "off",
  EVALUATION_WORKER: "off",
  SESSION_CLEANUP_CRON: "off",
  OLLAMA_BASE_URL: "http://127.0.0.1:1",
  PROCTORING_ENABLED: "true",
  PROCTORING_TOKEN_SECRET: secret(),
  PROCTORING_EVIDENCE_KEYS: `k1:${crypto.randomBytes(32).toString("base64")}`,
  PROCTORING_STORAGE_DRIVER: "local",
  PROCTORING_TEMP_DIR: forward(path.join(LOCAL_ROOT, "frames")),
  PROCTORING_LOCAL_STORE_DIR: forward(path.join(LOCAL_ROOT, "evidence-store")),
  AI_SERVICE_URL: "http://127.0.0.1:8018",
  AI_SERVICE_TOKEN: secret(),
};

fs.mkdirSync(LOCAL_ROOT, { recursive: true });
fs.writeFileSync(LOCAL_ENV, `${Object.entries(lines).map(([k, v]) => `${k}=${v}`).join("\n")}\n`, { mode: 0o600 });
console.log("[proctoring-local] Created .env.proctoring-local (git-ignored). No secret was printed.");
