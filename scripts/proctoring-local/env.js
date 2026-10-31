/**
 * Local-only environment for proctoring development and tests.
 *
 * Reads .env.proctoring-local (git-ignored) and refuses to continue unless both
 * database URLs are on a loopback address. Every other variable named in the
 * normal .env is set to an empty string first, because dotenv and the Prisma
 * client never overwrite a variable that already exists: this is what keeps the
 * hosted database, mail and LLM keys in .env out of a local run. Values from
 * .env are never read, only its names.
 */
const fs = require("fs");
const path = require("path");

const API_ROOT = path.resolve(__dirname, "..", "..");
const LOCAL_ENV = path.join(API_ROOT, ".env.proctoring-local");
const LOCAL_ROOT = path.resolve(API_ROOT, "..", "..", ".proctoring-local");
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

const parseEnvText = (text) => {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) out[match[1]] = match[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return out;
};

const namesIn = (file) =>
  fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").split(/\r?\n/).map((line) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1]).filter(Boolean)
    : [];

/** A description of a database URL that is safe to print: never its credentials. */
function describeTarget(rawUrl) {
  const url = new URL(rawUrl);
  return { host: url.hostname, port: url.port, database: url.pathname.replace(/^\//, ""), loopback: LOOPBACK.has(url.hostname) };
}

function assertLocalDatabase(rawUrl, label) {
  if (!rawUrl) throw new Error(`[proctoring-local] ${label} is not set.`);
  const target = describeTarget(rawUrl);
  if (!target.loopback) throw new Error(`[proctoring-local] Refusing: ${label} is not a loopback address.`);
  if (!/^lms_proctoring_/.test(target.database)) throw new Error(`[proctoring-local] Refusing: ${label} must name a lms_proctoring_* database.`);
  return target;
}

function readLocalEnv() {
  if (!fs.existsSync(LOCAL_ENV)) {
    throw new Error("[proctoring-local] .env.proctoring-local is missing. Run: node scripts/proctoring-local/init-env.js");
  }
  return parseEnvText(fs.readFileSync(LOCAL_ENV, "utf8"));
}

/** Applies the local environment to this process. Returns printable database targets. */
function applyLocalEnv({ testRun = false } = {}) {
  const local = readLocalEnv();
  assertLocalDatabase(local.DATABASE_URL, "DATABASE_URL");
  assertLocalDatabase(local.TEST_DATABASE_URL, "TEST_DATABASE_URL");

  for (const name of [...namesIn(path.join(API_ROOT, ".env")), ...namesIn(path.join(API_ROOT, ".env.example"))]) {
    process.env[name] = "";
  }
  Object.assign(process.env, local);
  if (testRun) process.env.DATABASE_URL = local.TEST_DATABASE_URL;

  return { database: describeTarget(process.env.DATABASE_URL), test: describeTarget(local.TEST_DATABASE_URL) };
}

module.exports = { API_ROOT, LOCAL_ENV, LOCAL_ROOT, applyLocalEnv, assertLocalDatabase, describeTarget, readLocalEnv, parseEnvText };
