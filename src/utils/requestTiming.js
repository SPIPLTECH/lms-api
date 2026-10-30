const { AsyncLocalStorage } = require("async_hooks");

/**
 * Per-request timing: total time, time spent waiting on the database, and the
 * rest (auth checks, business logic, serialization, lock waits).
 *
 * The database figure is the wall-clock time during which at least one
 * Prisma operation of this request was in flight — the union of their
 * intervals, not their sum, so a Promise.all of five queries counts once.
 * It includes waiting for a pool connection, which on a remote database is
 * part of what the query costs.
 *
 * Reported two ways:
 *  - a `Server-Timing` response header (visible in the browser's Network tab,
 *    Timing panel), and
 *  - one log line per request slower than API_TIMING_LOG_MS (default 200;
 *    "off" disables the line, the header stays).
 */

const storage = new AsyncLocalStorage();

const SLOWEST_KEPT = 3;

const logThresholdMs = () => {
  const raw = (process.env.API_TIMING_LOG_MS || "").trim().toLowerCase();
  if (raw === "off") return null;
  const parsed = Number(raw);
  return raw && Number.isFinite(parsed) ? parsed : 200;
};

const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

const newStore = () => ({
  startedAt: nowMs(),
  queries: 0,
  inFlight: 0,
  peakInFlight: 0,
  busySince: 0,
  dbMs: 0,
  slowest: []
});

/** Wraps one Prisma operation; a no-op outside a request (jobs, sockets). */
async function timeQuery(label, run) {
  const store = storage.getStore();
  if (!store) return run();

  const started = nowMs();
  store.queries += 1;
  if (store.inFlight === 0) store.busySince = started;
  store.inFlight += 1;
  store.peakInFlight = Math.max(store.peakInFlight, store.inFlight);
  try {
    return await run();
  } finally {
    const ended = nowMs();
    store.inFlight -= 1;
    if (store.inFlight === 0) store.dbMs += ended - store.busySince;
    const ms = ended - started;
    if (store.slowest.length < SLOWEST_KEPT || ms > store.slowest[store.slowest.length - 1].ms) {
      store.slowest.push({ label, ms });
      store.slowest.sort((a, b) => b.ms - a.ms);
      store.slowest.length = Math.min(store.slowest.length, SLOWEST_KEPT);
    }
  }
}

/** Prisma client extension feeding timeQuery. */
const prismaTimingExtension = {
  name: "requestTiming",
  query: {
    $allOperations({ model, operation, args, query }) {
      return timeQuery(model ? `${model}.${operation}` : operation, () => query(args));
    }
  }
};

const summarize = (store) => {
  const totalMs = nowMs() - store.startedAt;
  // A query still running (a fire-and-forget write) counts up to now.
  const dbMs = store.dbMs + (store.inFlight > 0 ? nowMs() - store.busySince : 0);
  return { totalMs, dbMs, appMs: Math.max(0, totalMs - dbMs) };
};

const round = (ms) => Math.round(ms);

function requestTiming(req, res, next) {
  const store = newStore();

  const writeHead = res.writeHead;
  res.writeHead = function writeHeadWithTiming(...args) {
    if (!res.headersSent) {
      const { totalMs, dbMs, appMs } = summarize(store);
      res.setHeader(
        "Server-Timing",
        `total;dur=${round(totalMs)}, db;dur=${round(dbMs)};desc="${store.queries} queries", app;dur=${round(appMs)}`
      );
    }
    return writeHead.apply(this, args);
  };

  // Bytes actually sent. Registered before compression, so these hooks see
  // the compressed chunks (compression drops Content-Length).
  let bytesSent = 0;
  const countChunk = (chunk, encoding) => {
    if (chunk && typeof chunk !== "function") {
      bytesSent += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk), typeof encoding === "string" ? encoding : undefined);
    }
  };
  const write = res.write;
  res.write = function writeCounted(chunk, encoding, ...rest) {
    countChunk(chunk, encoding);
    return write.call(this, chunk, encoding, ...rest);
  };
  const end = res.end;
  res.end = function endCounted(chunk, encoding, ...rest) {
    countChunk(chunk, encoding);
    return end.call(this, chunk, encoding, ...rest);
  };

  res.on("finish", () => {
    const threshold = logThresholdMs();
    if (threshold === null || req.method === "OPTIONS") return;
    const { totalMs, dbMs, appMs } = summarize(store);
    if (totalMs < threshold) return;
    const encoding = res.getHeader("content-encoding");
    const bytes = `${bytesSent}${encoding ? `(${encoding})` : ""}`;
    const slowest = store.slowest.map((q) => `${q.label}=${round(q.ms)}`).join(" ");
    // Path only: query strings can carry ids worth keeping out of logs.
    const path = (req.originalUrl || req.url || "").split("?")[0];
    console.log(
      `[timing] ${req.method} ${path} ${res.statusCode} total=${round(totalMs)}ms db=${round(dbMs)}ms ` +
        `app=${round(appMs)}ms queries=${store.queries} peak=${store.peakInFlight} bytes=${bytes}` +
        (slowest ? ` slowest: ${slowest}` : "") +
        ` rid=${req.requestId || "-"}`
    );
  });

  storage.run(store, next);
}

/**
 * Runs `fn` in its own timing context and reports what the request line would
 * (for benchmarks and tests). Resolves to { result, totalMs, dbMs, appMs,
 * queries, peakInFlight, slowest }.
 */
async function measure(fn) {
  const store = newStore();
  const result = await storage.run(store, fn);
  return { result, ...summarize(store), queries: store.queries, peakInFlight: store.peakInFlight, slowest: store.slowest };
}

module.exports = { requestTiming, prismaTimingExtension, timeQuery, measure };
