// Un-stubbed queries go to a closed local port, never a real database.
process.env.TEST_DATABASE_URL = "postgresql://blocked:blocked@127.0.0.1:9/motivation_no_db";

const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const service = require("../src/modules/motivation/motivation.service");
const motivation = require("../src/modules/motivation");
const learningHealth = require("../src/modules/learning-health");
const retentionService = require("../src/modules/learner-model/retention.service");
const { createBackgroundQueue } = require("../src/utils/backgroundQueue");

const NOW = new Date("2026-03-10T15:00:00.000Z");
const DAY = 86_400_000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY);

function stub(t, target, methods) {
  const originals = {};
  for (const [name, fn] of Object.entries(methods)) {
    originals[name] = target[name];
    target[name] = fn;
  }
  t.after(() => Object.assign(target, originals));
}

/** A learner active the last 3 days, one course gone quiet, one assignment due soon. */
function stubReads(t, { existingNudges = [], existingStreak = null } = {}) {
  stub(t, prisma.lessonProgress, { findMany: async () => [{ visitedAt: daysAgo(0), completedAt: null }, { visitedAt: daysAgo(1), completedAt: daysAgo(2) }] });
  stub(t, prisma.contentProgress, { findMany: async () => [] });
  stub(t, prisma.quizAttempt, { findMany: async () => [] });
  stub(t, prisma.assignmentSubmission, { findMany: async () => [] });
  stub(t, prisma.enrollment, {
    findMany: async () => [
      { courseId: "c1", progressPercent: 30, completed: false, course: { title: "Java Basics" } },
      { courseId: "c2", progressPercent: 5, completed: false, course: { title: "SQL" } },
    ],
  });
  stub(t, learningHealth, { getStudentStates: async () => [{ courseId: "c2", inactivityDays: 8, improvementTrend: "STABLE" }] });
  stub(t, prisma.assignment, { findMany: async () => [{ id: "a1", title: "Essay", dueDate: new Date(NOW.getTime() + 5 * 3_600_000) }] });
  stub(t, retentionService, { getLearningSignals: async () => ({ signals: [{ concept: "Loops", retention: { status: "DECAYED" } }], calibration: null }) });
  stub(t, prisma.learningStreak, { findUnique: async () => existingStreak });
  stub(t, prisma.motivationNudge, { findMany: async () => existingNudges });
}

function stubWrites(t) {
  const writes = { ops: [] };
  stub(t, prisma.learningStreak, { upsert: (args) => (writes.streak = args, "streak") });
  stub(t, prisma.motivationNudge, {
    createMany: (args) => (writes.created = args.data, "createMany"),
    update: (args) => (writes.ops.push(["update", args]), "update"),
    updateMany: (args) => (writes.expired = args, "updateMany"),
    deleteMany: (args) => (writes.pruned = args, "deleteMany"),
  });
  stub(t, prisma, { $transaction: async (ops) => (writes.ops.push(["tx", ops]), ops) });
  return writes;
}

test("recomputeStudent writes the streak and the nudges the situation calls for, in one transaction", async (t) => {
  stubReads(t);
  const writes = stubWrites(t);
  const events = [];
  t.after(motivation.subscribe(motivation.MOTIVATION_EVENT_NAMES.MOTIVATION_UPDATED, (p) => events.push(p)));

  const result = await service.recomputeStudent("s1", { now: NOW });
  await new Promise(setImmediate);

  assert.strictEqual(result.streak.currentDays, 3);
  assert.strictEqual(writes.streak.update.status, "ACTIVE");
  assert.deepStrictEqual(writes.streak.update.celebratedMilestones, [3]);

  const types = writes.created.map((c) => `${c.type}:${c.dedupeKey}`).sort();
  assert.ok(types.includes("STREAK_MILESTONE:3:2026-03-08"), types.join());
  assert.ok(types.includes("COMEBACK:c2:2026-03-02"), types.join());
  assert.ok(types.includes("DEADLINE:a1:soon"), types.join());
  assert.ok(types.some((k) => k.startsWith("REVISION:loops:")), types.join());
  assert.ok(types.includes("PROGRESS_MILESTONE:c1:25"), types.join());
  assert.ok(writes.created.every((c) => c.studentId === "s1" && c.status === "ACTIVE"));
  assert.strictEqual(writes.ops.filter(([kind]) => kind === "tx").length, 1);
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].studentId, "s1");
});

test("a dismissed nudge is not recreated", async (t) => {
  stubReads(t, {
    existingNudges: [{ id: "n1", type: "DEADLINE", dedupeKey: "a1:soon", status: "DISMISSED", priority: "HIGH", title: "x", message: "m" }],
  });
  const writes = stubWrites(t);
  await service.recomputeStudent("s1", { now: NOW });
  assert.ok(!writes.created.some((c) => c.type === "DEADLINE"));
});

test("dismissNudge only affects the student's own active nudge", async (t) => {
  stub(t, prisma.studentProfile, { findUnique: async ({ where }) => (where.userId === "u1" ? { id: "s1" } : null) });
  const calls = [];
  stub(t, prisma.motivationNudge, {
    updateMany: async (args) => {
      calls.push(args.where);
      return { count: args.where.id === "mine" ? 1 : 0 };
    },
  });

  assert.deepStrictEqual(await service.dismissNudge({ id: "u1" }, "mine"), { id: "mine", status: "DISMISSED" });
  assert.deepStrictEqual(calls[0], { id: "mine", studentId: "s1", status: "ACTIVE" });
  await assert.rejects(service.dismissNudge({ id: "u1" }, "someone-elses"), (e) => e.statusCode === 404);
  await assert.rejects(service.dismissNudge({ id: "u-no-profile" }, "mine"), (e) => e.statusCode === 404);
});

test("cross-agent getters never throw", async (t) => {
  const boom = async () => {
    throw new Error("db down");
  };
  stub(t, prisma.learningStreak, { findUnique: boom, findMany: boom });
  stub(t, prisma.motivationNudge, { findMany: boom });
  stub(t, console, { warn: () => {} });
  assert.strictEqual(await motivation.getStreak("s1"), null);
  assert.deepStrictEqual(await motivation.getActiveNudges("s1"), []);
  assert.deepStrictEqual(await motivation.getBatchStreaks(["s1"]), []);
});

test("backgroundQueue debounces per key and caps concurrency", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let running = 0;
  let peak = 0;
  const ran = [];
  const releases = [];
  const queue = createBackgroundQueue({ name: "t", debounceMs: 100, concurrency: 2 });
  const job = (k) => () =>
    new Promise((resolve) => {
      running += 1;
      peak = Math.max(peak, running);
      ran.push(k);
      releases.push(() => {
        running -= 1;
        resolve();
      });
    });

  queue.schedule("a", job("a-first"));
  queue.schedule("a", job("a-latest")); // replaces the first
  queue.schedule("b", job("b"));
  queue.schedule("c", job("c"));
  t.mock.timers.tick(100);
  await new Promise(setImmediate);

  assert.deepStrictEqual(ran, ["a-latest", "b"]); // c waits: concurrency 2
  releases.shift()();
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.deepStrictEqual(ran, ["a-latest", "b", "c"]);
  assert.strictEqual(peak, 2);
  releases.forEach((r) => r());
});
