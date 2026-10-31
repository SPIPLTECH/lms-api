/**
 * Runs LMS API tests against the disposable local database only.
 *
 *   node scripts/proctoring-local/test.js                    the whole suite
 *   node scripts/proctoring-local/test.js test/x.test.js     chosen files
 *   --report=<file>                                          keep the full output
 *
 * Confirms the live target first (database name and loopback address, no secrets).
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Client } = require("pg");
const { API_ROOT, applyLocalEnv } = require("./env");

async function confirmTarget() {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT current_database() AS db, inet_server_addr()::text AS addr");
    const { db, addr } = rows[0];
    if (!/^lms_proctoring_test$/.test(db) || !/^(127\.0\.0\.1|::1)/.test(addr || "")) {
      throw new Error("[proctoring-local] Refusing to run tests: the live database is not the local test database.");
    }
    console.log(`[proctoring-local] Test database confirmed: ${db} on ${addr}`);
  } finally {
    await client.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const reportArg = args.find((a) => a.startsWith("--report="));
  const files = args.filter((a) => !a.startsWith("--"));
  applyLocalEnv({ testRun: true });
  await confirmTarget();

  const guard = path.join(__dirname, "net-guard.cjs").replace(/\\/g, "/");
  const env = { ...process.env, NODE_OPTIONS: `--require "${guard}"`, NODE_ENV: "test", ENABLE_SERVER_TIMING: "true" };
  const testArgs = ["--test", ...(files.length ? files : ["test/*.test.js", "src/**/*.test.js"])];
  const report = reportArg ? fs.createWriteStream(reportArg.split("=")[1]) : null;
  const child = spawn(process.execPath, testArgs, { cwd: API_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => (report ? report.write(chunk) : process.stdout.write(chunk)));
  }
  child.on("exit", (code) => {
    if (report) report.end();
    process.exitCode = code ?? 1;
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
