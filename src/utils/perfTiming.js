const { AsyncLocalStorage } = require("async_hooks");

/**
 * Opt-in request timing: with PERF_TIMING=1 every request logs one line —
 * method, URL, status, wall time and how many Prisma operations it ran:
 *
 *   [perf] GET /progress/learning-sequence?courseId=… 200 2140ms prisma=14
 *
 * The database is remote (~0.5s per round trip), so the operation count is
 * what explains a slow endpoint. It counts Prisma calls, not SQL statements:
 * a nested include is one call (one statement under relationJoins), and an
 * interactive transaction's BEGIN/COMMIT are not counted. Calls made side by
 * side in a Promise.all are all counted, though they cost one round trip.
 *
 * Off (the default, and always in production) nothing here is loaded:
 * config/database.js exports the plain client and app.js mounts nothing.
 */
const PERF_TIMING_ENABLED = process.env.PERF_TIMING === "1";

const requestStore = new AsyncLocalStorage();

/** The Prisma client, extended to count each operation against the request it ran for. */
function instrumentPrisma(client) {
  return client.$extends({
    query: {
      async $allOperations({ args, query }) {
        const stats = requestStore.getStore();
        if (stats) stats.prismaOps += 1;
        return query(args);
      },
    },
  });
}

function perfTimingMiddleware(req, res, next) {
  const stats = { prismaOps: 0 };
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(`[perf] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms prisma=${stats.prismaOps}`);
  });
  requestStore.run(stats, next);
}

module.exports = { PERF_TIMING_ENABLED, instrumentPrisma, perfTimingMiddleware };
