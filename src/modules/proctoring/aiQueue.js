const { proctoringSettings } = require("../../config/proctoring");

/**
 * The bounded queue between uploads and the AI. An upload returns after saving to disk;
 * this runs the rest. Ported from ProctorGuard's analysis queue, with a priority lane:
 *
 *   - at most `concurrency` analyses at once, so exams cannot starve the LMS;
 *   - at most `maxQueued` frames waiting. A full queue refuses, and the caller keeps the
 *     frame as unanalysed evidence. Nothing is silently dropped;
 *   - one attempt's frames run in order, never two at once, so the rules see a consistent sequence;
 *   - identity photos go first and have their own room, so a student at the door never
 *     waits behind a running exam's frames.
 */

const SAMPLE_LIMIT = 2000;
const PRIORITY_ROOM_MIN = 20;

class LatencySamples {
  constructor() {
    this.values = [];
  }
  add(ms) {
    this.values.push(ms);
    if (this.values.length > SAMPLE_LIMIT) this.values.shift();
  }
  summary() {
    if (this.values.length === 0) return { count: 0, p50: null, p95: null, max: null };
    const sorted = [...this.values].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return { count: sorted.length, p50: Math.round(at(0.5)), p95: Math.round(at(0.95)), max: Math.round(sorted[sorted.length - 1]) };
  }
}

class AnalysisQueue {
  constructor(concurrency, maxQueued) {
    this.concurrency = concurrency;
    this.maxQueued = maxQueued;
    this.resetMetrics();
    this.waiting = [];
    this.priorityWaiting = [];
    this.activeAttempts = new Set();
    this.running = 0;
    this.idleResolvers = [];
  }

  /** Returns false, and queues nothing, when there is no room. */
  enqueue(job) {
    const lane = job.priority ? this.priorityWaiting : this.waiting;
    const room = job.priority ? Math.max(PRIORITY_ROOM_MIN, Math.floor(this.maxQueued() / 10)) : this.maxQueued();
    if (lane.length >= room) {
      this.counters.rejectedQueueFull += 1;
      return false;
    }
    lane.push({ ...job, enqueuedAt: Date.now() });
    this.counters.enqueued += 1;
    this.maxBacklog = Math.max(this.maxBacklog, this.waiting.length);
    this.pump();
    return true;
  }

  takeNext() {
    for (const lane of [this.priorityWaiting, this.waiting]) {
      const index = lane.findIndex((job) => !this.activeAttempts.has(job.attemptId));
      if (index !== -1) return lane.splice(index, 1)[0];
    }
    return null;
  }

  pump() {
    while (this.running < this.concurrency()) {
      const job = this.takeNext();
      if (!job) break;
      this.running += 1;
      this.activeAttempts.add(job.attemptId);
      this.process(job).finally(() => {
        this.running -= 1;
        this.activeAttempts.delete(job.attemptId);
        this.pump();
        if (this.running === 0 && this.waiting.length === 0 && this.priorityWaiting.length === 0) {
          const resolvers = this.idleResolvers;
          this.idleResolvers = [];
          resolvers.forEach((resolve) => resolve());
        }
      });
    }
  }

  async process(job) {
    const started = Date.now();
    this.queueWait.add(started - job.enqueuedAt);
    let outcome;
    try {
      outcome = await job.run();
      this.analysis.add(Date.now() - started);
      this.counters.completed += 1;
    } catch (error) {
      this.counters.crashed += 1;
      console.error("[proctoring-queue] job failed:", error?.message);
    }
    try {
      job.onDone?.(outcome);
    } catch {
      // A waiting upload must never break the queue.
    }
  }

  /** Resolves when nothing is waiting or running. */
  drain() {
    if (this.running === 0 && this.waiting.length === 0 && this.priorityWaiting.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  metrics() {
    const uptimeSeconds = Math.max(1, (Date.now() - this.startedAt) / 1000);
    return {
      backlog: this.waiting.length,
      priorityBacklog: this.priorityWaiting.length,
      inFlight: this.running,
      maxBacklog: this.maxBacklog,
      concurrency: this.concurrency(),
      queueLimit: this.maxQueued(),
      ...this.counters,
      throughputPerMinute: Math.round((this.counters.completed / uptimeSeconds) * 600) / 10,
      latencyMs: { queueWait: this.queueWait.summary(), analysis: this.analysis.summary() },
      since: new Date(this.startedAt).toISOString(),
    };
  }

  resetMetrics() {
    this.startedAt = Date.now();
    this.counters = { enqueued: 0, completed: 0, rejectedQueueFull: 0, crashed: 0 };
    this.maxBacklog = 0;
    this.queueWait = new LatencySamples();
    this.analysis = new LatencySamples();
  }
}

const analysisQueue = new AnalysisQueue(
  () => proctoringSettings().queueConcurrency,
  () => proctoringSettings().queueMax
);

const MAX_BACKOFF_SECONDS = 15;

/**
 * Back-pressure: as the backlog grows, browsers are asked to capture less often, up to
 * 15 s. It never asks for faster than the configured interval.
 */
function intervalFor(baseSeconds, { backlog, queueLimit }) {
  const load = queueLimit > 0 ? backlog / queueLimit : 0;
  const wanted = load >= 0.5 ? MAX_BACKOFF_SECONDS : load >= 0.25 ? 10 : baseSeconds;
  return Math.max(baseSeconds, wanted);
}

module.exports = { AnalysisQueue, analysisQueue, intervalFor };
