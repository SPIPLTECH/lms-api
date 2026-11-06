/**
 * Starts the LMS API on the disposable local database, never with the normal .env. Everything
 * else (AI process, jobs) starts as it would in production, except that the network guard refuses
 * anything that is not this machine, so no test can reach a hosted service or send real mail.
 *
 *   node scripts/proctoring-local/server.js [--port=5055] [--ai-port=8028] [--db-port=54362] [--frontend=http://localhost:3055]
 *
 * The options let it run beside a dev server already using the usual ports. --db-port points at
 * scripts/proctoring-local/slow-db-proxy.mjs, for measuring with a remote database's delay.
 */
const path = require("path");
const { Client } = require("pg");
const { applyLocalEnv, assertLocalDatabase } = require("./env");

const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];

function applyOptions() {
  if (option("port")) process.env.PORT = option("port");
  if (option("ai-port")) process.env.AI_SERVICE_URL = `http://127.0.0.1:${option("ai-port")}`;
  if (option("frontend")) process.env.FRONTEND_URL = option("frontend");
  if (option("db-port")) {
    const url = new URL(process.env.DATABASE_URL);
    url.port = option("db-port");
    process.env.DATABASE_URL = url.toString();
  }
}

async function main() {
  applyLocalEnv({ testRun: false });
  applyOptions();
  assertLocalDatabase(process.env.DATABASE_URL);
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query("SELECT current_database() AS db, inet_server_addr()::text AS addr");
  await client.end();
  const { db, addr } = rows[0];
  if (!/^lms_proctoring_/.test(db) || !/^(127\.0\.0\.1|::1)/.test(addr || "")) {
    throw new Error("[proctoring-local] Refusing to start: the live database is not a disposable local one.");
  }
  console.log(`[proctoring-local] API database confirmed: ${db} on ${addr}`);
  require("./net-guard.cjs");
  require(path.resolve(__dirname, "../../server.js"));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
