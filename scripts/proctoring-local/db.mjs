// Disposable local PostgreSQL for proctoring development (embedded, no install).
//
//   node scripts/proctoring-local/db.mjs start   runs until `stop` is requested
//   node scripts/proctoring-local/db.mjs stop    asks a running server to stop cleanly
//
// Data lives in C:\Orange Tree LMS\.proctoring-local\pg, outside both repositories.
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import EmbeddedPostgres from "embedded-postgres";

const require = createRequire(import.meta.url);
const { LOCAL_ROOT, assertLocalDatabase, readLocalEnv } = require("./env.js");

const local = readLocalEnv();
assertLocalDatabase(local.DATABASE_URL, "DATABASE_URL");
assertLocalDatabase(local.TEST_DATABASE_URL, "TEST_DATABASE_URL");

const url = new URL(local.DATABASE_URL);
const dataDir = path.join(LOCAL_ROOT, "pg");
const stopFile = path.join(LOCAL_ROOT, "pg.stop");
const readyFile = path.join(LOCAL_ROOT, "pg.ready");

if (process.argv[2] === "stop") {
  fs.writeFileSync(stopFile, "stop");
  console.log("[proctoring-local] stop requested.");
  process.exit(0);
}

fs.mkdirSync(LOCAL_ROOT, { recursive: true });
fs.rmSync(stopFile, { force: true });
fs.rmSync(readyFile, { force: true });

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  port: Number(url.port),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  authMethod: "scram-sha-256",
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  persistent: true,
  onLog: () => {},
});

if (!fs.existsSync(path.join(dataDir, "PG_VERSION"))) await pg.initialise();
await pg.start();

const admin = pg.getPgClient("postgres", "127.0.0.1");
await admin.connect();
for (const raw of [local.DATABASE_URL, local.TEST_DATABASE_URL]) {
  const name = new URL(raw).pathname.slice(1);
  const found = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
  if (found.rowCount === 0) await admin.query(`CREATE DATABASE ${name}`);
}
await admin.end();

fs.writeFileSync(readyFile, "ready");
console.log(`[proctoring-local] PostgreSQL ready on 127.0.0.1:${url.port}.`);

setInterval(async () => {
  if (!fs.existsSync(stopFile)) return;
  await pg.stop();
  fs.rmSync(stopFile, { force: true });
  fs.rmSync(readyFile, { force: true });
  console.log("[proctoring-local] PostgreSQL stopped.");
  process.exit(0);
}, 500);
