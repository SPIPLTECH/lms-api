/**
 * A small keyed, debounced, concurrency-limited background queue for the
 * adaptive agents.
 *
 * Why: a nightly Learning Health sweep publishes one `learning-health:updated`
 * per learner. An agent reacting to each event directly would start N
 * recomputes at once — N x several queries against a ~458ms-round-trip
 * database. Here each key is debounced (a burst for one key collapses into a
 * single job) and at most `concurrency` jobs run at a time.
 *
 * `schedule` is synchronous and never throws; job failures are logged by the
 * owner's `onError`, never propagated. Timers are unref'd so the queue never
 * keeps a process (or a test run) alive.
 *
 * @param {{name: string, debounceMs: number, concurrency?: number, onError?: (error: Error, key: string) => void}} options
 */
function createBackgroundQueue({ name, debounceMs, concurrency = 2, onError }) {
  const timers = new Map(); // key -> timeout (debouncing)
  const waiting = new Map(); // key -> job (ready, not started)
  let running = 0;

  const report = (error, key) => {
    try {
      if (onError) onError(error, key);
      else console.warn(`[${name}] background job failed`, { key, error: error?.message });
    } catch {
      // A failing error reporter must not break the queue.
    }
  };

  const pump = () => {
    while (running < concurrency && waiting.size > 0) {
      const [key, job] = waiting.entries().next().value;
      waiting.delete(key);
      running += 1;
      Promise.resolve()
        .then(job)
        .catch((error) => report(error, key))
        .finally(() => {
          running -= 1;
          pump();
        });
    }
  };

  /**
   * (Re)schedules the job for `key`; the latest job for a key wins.
   * @param {string} key
   * @param {() => Promise<unknown>} job
   */
  const schedule = (key, job) => {
    try {
      const existing = timers.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        timers.delete(key);
        waiting.set(key, job);
        pump();
      }, debounceMs);
      if (typeof timer?.unref === "function") timer.unref();
      timers.set(key, timer);
    } catch (error) {
      report(error, key);
    }
  };

  return {
    schedule,
    get pendingCount() {
      return timers.size + waiting.size;
    },
    get runningCount() {
      return running;
    },
  };
}

module.exports = { createBackgroundQueue };
