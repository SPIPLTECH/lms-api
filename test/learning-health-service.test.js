// Point any un-stubbed query at an unreachable local address BEFORE the
// Prisma client is created, so a gap in the stubs below fails fast instead of
// touching a real database. (config/database.js reads TEST_DATABASE_URL under
// the node test runner.)
process.env.TEST_DATABASE_URL = "postgresql://blocked:blocked@127.0.0.1:9/learning_health_no_db";

const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const service = require("../src/modules/learning-health/learningHealth.service");
const signals = require("../src/modules/learning-health/learningHealth.signals");
const learningHealth = require("../src/modules/learning-health");
const config = require("../src/modules/learning-health/learningHealth.config");

// The invariants under test, for the Learning Health service:
//
//  1. A recompute is batched: signals for many learners in one call, writes in
//     chunked transactions, one STATE_UPDATED event per learner.
//  2. The write-path trigger never affects its caller: synchronous, never
//     throws, collapses bursts into one recompute, swallows failures.
//  3. An instructor sees their own courses only; missing and not-yours are
//     indistinguishable (404).
//  4. The cross-agent getters never throw.

const NOW = new Date("2026-03-01T12:00:00.000Z");
const COURSE = "course-1";
const INSTRUCTOR = { id: "user-instructor", role: "INSTRUCTOR" };
const OTHER_INSTRUCTOR = { id: "user-other", role: "INSTRUCTOR" };
const ADMIN = { id: "user-admin", role: "ADMIN" };

const learnerSignals = (studentId, previousRiskLevel = null) => ({
  studentId,
  previousRiskLevel,
  signals: {
    now: NOW,
    enrolledAt: new Date(NOW.getTime() - 60 * 86_400_000),
    completed: false,
    progressPercent: 50,
    lastActivityAt: NOW,
    hasAnyActivity: true,
    activeDates: new Set(["2026-03-01", "2026-02-28", "2026-02-27", "2026-02-25", "2026-02-23", "2026-02-21", "2026-02-19"]),
    videoMinutes: 0,
    courseHasVideo: false,
    quizAttempts: [{ percentage: 80, passed: true, correctCount: 8, incorrectCount: 2 }],
    assignmentScores: [],
    masteryScores: [],
    deadlines: { hasDeadlines: false, overdue: 0, dueSoonDaysLeft: [] },
  },
});

/** Replaces methods for one test and restores them after it. */
function stub(t, target, methods) {
  const originals = {};
  for (const [name, fn] of Object.entries(methods)) {
    originals[name] = target[name];
    target[name] = fn;
  }
  t.after(() => Object.assign(target, originals));
}

/** Stubs the write side and records what would have been written. */
function stubWrites(t) {
  const writes = { transactions: [], upserts: [], history: [] };
  stub(t, prisma.learningHealth, {
    upsert: (args) => {
      writes.upserts.push(args);
      return { op: "upsert" };
    },
  });
  stub(t, prisma.learningHealthHistory, {
    upsert: (args) => {
      writes.history.push(args);
      return { op: "history" };
    },
  });
  stub(t, prisma, {
    $transaction: async (ops) => {
      writes.transactions.push(ops.length);
      return ops;
    },
  });
  return writes;
}

/** Ownership is folded into the course lookup, as in instructorInsights. */
function stubCourse(t, owner = INSTRUCTOR.id) {
  stub(t, prisma.course, {
    findFirst: async ({ where }) => {
      if (where.id !== COURSE) return null;
      if (where.creatorId && where.creatorId !== owner) return null;
      return { id: COURSE, title: "Java Programming Fundamentals" };
    },
  });
}

test("recomputeCourse writes both tables in chunked transactions and publishes per learner", async (t) => {
  const ids = Array.from({ length: 120 }, (_, i) => `s${i}`);
  stub(t, signals, { fetchCourseSignals: async () => ids.map((id) => learnerSignals(id, id === "s0" ? "HIGH" : null)) });
  const writes = stubWrites(t);

  const events = [];
  const unsubscribe = learningHealth.subscribe(learningHealth.LEARNING_HEALTH_EVENT_NAMES.STATE_UPDATED, (p) => events.push(p));
  t.after(unsubscribe);

  const count = await service.recomputeCourse(COURSE, { now: NOW });
  await new Promise(setImmediate); // subscribers run asynchronously

  assert.strictEqual(count, 120);
  assert.deepStrictEqual(writes.transactions, [100, 100, 40]); // 50 learners x 2 upserts per chunk
  assert.strictEqual(writes.upserts.length, 120);
  assert.strictEqual(writes.history.length, 120);
  assert.deepStrictEqual(writes.upserts[0].where, { studentId_courseId: { studentId: "s0", courseId: COURSE } });
  assert.strictEqual(writes.history[0].where.studentId_courseId_date.date.toISOString(), "2026-03-01T00:00:00.000Z");
  assert.strictEqual(events.length, 120);
  assert.deepStrictEqual(
    { studentId: events[0].studentId, riskLevel: events[0].riskLevel, previousRiskLevel: events[0].previousRiskLevel },
    { studentId: "s0", riskLevel: "LOW", previousRiskLevel: "HIGH" }
  );
});

test("a course with no enrolments writes nothing", async (t) => {
  stub(t, signals, { fetchCourseSignals: async () => [] });
  const writes = stubWrites(t);
  assert.strictEqual(await service.recomputeCourse(COURSE, { now: NOW }), 0);
  assert.strictEqual(writes.transactions.length, 0);
});

test("scheduleRecompute collapses a burst into one recompute for that learner", async (t) => {
  process.env.LEARNING_HEALTH_ENABLE_IN_TESTS = "true";
  t.after(() => delete process.env.LEARNING_HEALTH_ENABLE_IN_TESTS);
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const calls = [];
  stub(t, signals, {
    fetchCourseSignals: async (courseId, options) => {
      calls.push({ courseId, studentIds: options.studentIds });
      return [];
    },
  });

  for (let i = 0; i < 5; i++) assert.strictEqual(service.scheduleRecompute("s1", COURSE), undefined);
  assert.strictEqual(service._pending.size, 1);

  t.mock.timers.tick(config.DEBOUNCE_MS - 1);
  assert.strictEqual(calls.length, 0);
  t.mock.timers.tick(1);
  await new Promise(setImmediate);

  assert.deepStrictEqual(calls, [{ courseId: COURSE, studentIds: ["s1"] }]);
  assert.strictEqual(service._pending.size, 0);
});

test("a failing background recompute is swallowed, never thrown to the caller", async (t) => {
  process.env.LEARNING_HEALTH_ENABLE_IN_TESTS = "true";
  t.after(() => delete process.env.LEARNING_HEALTH_ENABLE_IN_TESTS);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  stub(t, signals, { fetchCourseSignals: async () => { throw new Error("db down"); } });
  stub(t, console, { warn: () => {} });

  assert.doesNotThrow(() => service.scheduleRecompute("s1", COURSE));
  t.mock.timers.tick(config.DEBOUNCE_MS);
  await new Promise(setImmediate);
  assert.strictEqual(service._pending.size, 0);
});

test("scheduleRecompute is a no-op under the test runner unless opted in, and without ids", (t) => {
  delete process.env.LEARNING_HEALTH_ENABLE_IN_TESTS;
  service.scheduleRecompute("s1", COURSE);
  service.scheduleRecompute(null, COURSE);
  assert.strictEqual(service._pending.size, 0);
});

test("an instructor who does not own the course gets 404, the owner and an admin do not", async (t) => {
  stubCourse(t);
  stub(t, prisma.learningHealth, {
    groupBy: async () => [{ riskLevel: "HIGH", _count: { _all: 2 }, _max: { computedAt: NOW } }],
    findMany: async () => [],
    count: async () => 0,
  });

  await assert.rejects(
    service.getCourseOverview(OTHER_INSTRUCTOR, { courseId: COURSE }),
    (error) => error.statusCode === 404
  );
  await assert.rejects(
    service.getCourseOverview(INSTRUCTOR, { courseId: "no-such-course" }),
    (error) => error.statusCode === 404
  );

  const own = await service.getCourseOverview(INSTRUCTOR, { courseId: COURSE });
  assert.strictEqual(own.summary.counts.HIGH, 2);
  assert.strictEqual(own.summary.total, 2);
  await service.getCourseOverview(ADMIN, { courseId: COURSE });
});

test("cold start: a course with enrolments but no rows is computed once before answering", async (t) => {
  stubCourse(t);
  let computed = false;
  stub(t, signals, {
    fetchCourseSignals: async () => {
      computed = true;
      return [learnerSignals("s1")];
    },
  });
  stubWrites(t);
  stub(t, prisma.enrollment, { count: async () => 1 });
  stub(t, prisma.learningHealth, {
    groupBy: async () => (computed ? [{ riskLevel: "LOW", _count: { _all: 1 }, _max: { computedAt: NOW } }] : []),
    findMany: async () => [],
    count: async () => 1,
  });

  const result = await service.getCourseOverview(INSTRUCTOR, { courseId: COURSE });
  assert.ok(computed);
  assert.strictEqual(result.summary.counts.LOW, 1);
});

test("manual recompute is throttled per course for five minutes", async (t) => {
  stubCourse(t);
  stub(t, signals, { fetchCourseSignals: async () => [] });
  service._lastManualRecompute.clear();
  t.after(() => service._lastManualRecompute.clear());

  const first = await service.manualRecompute(INSTRUCTOR, { courseId: COURSE, now: NOW });
  assert.strictEqual(first.throttled, false);

  const second = await service.manualRecompute(INSTRUCTOR, { courseId: COURSE, now: new Date(NOW.getTime() + 60_000) });
  assert.deepStrictEqual(second, { throttled: true, retryAfterSeconds: 240 });

  const later = await service.manualRecompute(INSTRUCTOR, { courseId: COURSE, now: new Date(NOW.getTime() + config.MANUAL_RECOMPUTE_COOLDOWN_MS) });
  assert.strictEqual(later.throttled, false);
});

test("cross-agent getters resolve to null / [] on failure instead of throwing", async (t) => {
  const boom = async () => {
    throw new Error("db down");
  };
  stub(t, prisma.learningHealth, { findUnique: boom, findMany: boom });
  stub(t, console, { warn: () => {} });

  assert.strictEqual(await learningHealth.getState("s1", COURSE), null);
  assert.deepStrictEqual(await learningHealth.getCourseStates(COURSE), []);
  assert.deepStrictEqual(await learningHealth.getBatchStates(COURSE, ["s1"]), []);
  assert.deepStrictEqual(await learningHealth.getBatchStates(COURSE, []), []);
  assert.deepStrictEqual(await learningHealth.getHighRiskStudents(), []);
});
