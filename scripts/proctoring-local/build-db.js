/**
 * Builds the disposable local databases from an EMPTY state:
 *   1. the schema as it was before proctoring (`prisma db push` from a temp copy),
 *   2. the partial indexes the existing SQL scripts add,
 *   3. every hand-written proctoring SQL file (scripts/proctoring/*.up.sql), in order,
 *   4. `prisma migrate diff` against the working schema, to prove the SQL matches it.
 *
 * Refuses unless the target is loopback, named lms_proctoring_*, and has no tables yet.
 * Pass --reset to drop and recreate the two lms_proctoring_* databases first.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const { Client } = require("pg");
const { API_ROOT, LOCAL_ROOT, assertLocalDatabase, describeTarget, readLocalEnv } = require("./env");

const local = readLocalEnv();
const targets = [local.DATABASE_URL, local.TEST_DATABASE_URL];
targets.forEach((url, i) => assertLocalDatabase(url, i ? "TEST_DATABASE_URL" : "DATABASE_URL"));

// The last commit before any proctoring change: the schema the real database has today.
const BASE_COMMIT = "3e45203";
const EXISTING_SQL = [
  "add-auth-sessions-playback.sql",
  "auth-sessions-per-device.sql",
  "content-sequence-2-constraints.sql",
  "assignment-evaluation-2-review-workflow.sql",
];

const prismaCli = require.resolve("prisma/build/index.js");
const prisma = (args, url, cwd) =>
  spawnSync(process.execPath, [prismaCli, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
  });

const withClient = async (url, fn) => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
};

async function resetDatabases() {
  const adminUrl = new URL(targets[0]);
  adminUrl.pathname = "/postgres";
  await withClient(adminUrl.toString(), async (client) => {
    for (const url of targets) {
      const name = new URL(url).pathname.slice(1);
      await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await client.query(`CREATE DATABASE ${name}`);
    }
  });
}

async function build(url, baseSchemaPath, workDir) {
  const target = describeTarget(url);
  const tableCount = await withClient(url, async (client) => {
    const { rows } = await client.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'");
    return rows[0].n;
  });
  if (tableCount > 0) throw new Error(`[proctoring-local] ${target.database} is not empty (${tableCount} tables). Use --reset.`);

  const push = prisma(["db", "push", "--schema", baseSchemaPath, "--skip-generate"], url, workDir);
  if (push.status !== 0) throw new Error(`prisma db push failed for ${target.database}:\n${push.stderr || push.stdout}`);

  await withClient(url, async (client) => {
    for (const file of EXISTING_SQL) {
      await client.query(fs.readFileSync(path.join(API_ROOT, "scripts", file), "utf8"));
    }
    const dir = path.join(API_ROOT, "scripts", "proctoring");
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".up.sql")).sort()) {
        await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
        console.log(`[proctoring-local] ${target.database}: applied ${file}`);
      }
    }
  });

  const drift = prisma(
    ["migrate", "diff", "--from-url", url, "--to-schema-datamodel", path.join(API_ROOT, "prisma", "schema.prisma"), "--script"],
    url,
    workDir
  );
  if (drift.status !== 0) throw new Error(`prisma migrate diff failed:\n${drift.stderr || drift.stdout}`);
  const statements = drift.stdout.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("--"));
  // Partial indexes live only in SQL; Prisma cannot express them and reports them as extras.
  const unexpected = statements.filter((l) => !/^DROP INDEX /.test(l));
  console.log(`[proctoring-local] ${target.database}: built on ${target.host}:${target.port}; schema differences beyond SQL-only indexes: ${unexpected.length}`);
  if (unexpected.length > 0) console.log(unexpected.join("\n"));
  return unexpected.length;
}

async function main() {
  if (process.argv.includes("--reset")) await resetDatabases();
  const workDir = path.join(LOCAL_ROOT, "schema-work");
  fs.mkdirSync(workDir, { recursive: true });
  try {
    const baseSchema = execFileSync("git", ["show", `${BASE_COMMIT}:prisma/schema.prisma`], { cwd: API_ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
    const baseSchemaPath = path.join(workDir, "schema.prisma");
    fs.writeFileSync(baseSchemaPath, baseSchema);
    let differences = 0;
    for (const url of targets) differences += await build(url, baseSchemaPath, workDir);
    if (differences > 0) process.exitCode = 1;
  } finally {
    // Only a copy of the schema. Windows can briefly hold the folder after Prisma exits.
    try {
      fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* harmless: removed on the next run */
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
