const test = require("node:test");
const assert = require("node:assert");

const engine = require("../src/modules/motivation/motivation.engine");

// The invariants under test, for the Motivation agent's engine:
//
//  1. Streaks are consecutive UTC days of real activity; yesterday-but-not-
//     today is AT_RISK, not broken.
//  2. Milestones are celebrated once per streak.
//  3. A dismissed or expired nudge is never shown again; one-off celebrations
//     stay until they expire.
//  4. Wording is encouraging — no risk labels ever reach a student.

const NOW = new Date("2026-03-10T15:00:00.000Z");
const DAY = 86_400_000;
const key = (daysAgo) => new Date(NOW.getTime() - daysAgo * DAY).toISOString().slice(0, 10);
const days = (...ago) => new Set(ago.map(key));

const course = (overrides = {}) => ({
  courseId: "c1",
  title: "Java Basics",
  progressPercent: 10,
  completed: false,
  health: { inactivityDays: 0, improvementTrend: "STABLE" },
  ...overrides,
});

const context = (overrides = {}) => ({
  now: NOW,
  streak: engine.computeStreak({ activeDays: days(0), now: NOW }),
  courses: [course()],
  deadlines: [],
  decayedConcepts: [],
  ...overrides,
});

test("a streak counts consecutive active days ending today", () => {
  const streak = engine.computeStreak({ activeDays: days(0, 1, 2, 4), now: NOW });
  assert.strictEqual(streak.currentDays, 3);
  assert.strictEqual(streak.status, "ACTIVE");
  assert.strictEqual(streak.startedOn, key(2));
});

test("active yesterday but not today is AT_RISK and still counts", () => {
  const streak = engine.computeStreak({ activeDays: days(1, 2, 3, 4), now: NOW });
  assert.strictEqual(streak.status, "AT_RISK");
  assert.strictEqual(streak.currentDays, 4);
});

test("no activity today or yesterday is BROKEN, and longest is remembered", () => {
  const streak = engine.computeStreak({
    activeDays: days(5, 6, 7, 8, 9),
    now: NOW,
    existing: { longestDays: 12, celebratedMilestones: [3, 7] },
  });
  assert.strictEqual(streak.status, "BROKEN");
  assert.strictEqual(streak.currentDays, 0);
  assert.strictEqual(streak.longestDays, 12);
  assert.deepStrictEqual(streak.celebratedMilestones, []); // reset with the streak
});

test("a milestone is newly crossed once, then remembered", () => {
  const first = engine.computeStreak({ activeDays: days(0, 1, 2), now: NOW });
  assert.deepStrictEqual(first.newlyCrossed, [3]);
  const again = engine.computeStreak({ activeDays: days(0, 1, 2), now: NOW, existing: { celebratedMilestones: first.celebratedMilestones } });
  assert.deepStrictEqual(again.newlyCrossed, []);
});

test("streak at risk produces a nudge keyed to today", () => {
  const nudges = engine.detectNudges(context({ streak: engine.computeStreak({ activeDays: days(1, 2, 3), now: NOW }) }));
  const atRisk = nudges.find((n) => n.type === "STREAK_AT_RISK");
  assert.ok(atRisk);
  assert.strictEqual(atRisk.title, "Keep your 3-day streak going");
  assert.strictEqual(atRisk.dedupeKey, key(0));
});

test("comeback nudge after 3 days away, HIGH after 7, keyed to the inactivity episode", () => {
  const medium = engine.detectNudges(context({ courses: [course({ health: { inactivityDays: 4, improvementTrend: "STABLE" } })] }));
  const comeback = medium.find((n) => n.type === "COMEBACK");
  assert.strictEqual(comeback.priority, "MEDIUM");
  assert.strictEqual(comeback.dedupeKey, `c1:${key(4)}`);
  assert.strictEqual(comeback.ctaHref, "/student/learn/c1");

  const high = engine.detectNudges(context({ courses: [course({ health: { inactivityDays: 9, improvementTrend: "STABLE" } })] }));
  assert.strictEqual(high.find((n) => n.type === "COMEBACK").priority, "HIGH");

  const none = engine.detectNudges(context({ courses: [course({ health: { inactivityDays: 2, improvementTrend: "STABLE" } })] }));
  assert.ok(!none.some((n) => n.type === "COMEBACK"));
});

test("deadlines: urgent, soon and overdue are distinct; far-off ones are ignored", () => {
  const hours = (h) => new Date(NOW.getTime() + h * 3_600_000);
  const nudges = engine.detectNudges(
    context({
      deadlines: [
        { id: "a1", title: "Essay", dueDate: hours(5) },
        { id: "a2", title: "Lab", dueDate: hours(30) },
        { id: "a3", title: "Report", dueDate: hours(-20) },
        { id: "a4", title: "Later", dueDate: hours(100) },
      ],
    })
  );
  const byKey = Object.fromEntries(nudges.filter((n) => n.type === "DEADLINE").map((n) => [n.dedupeKey, n]));
  assert.strictEqual(byKey["a1:soon"].priority, "HIGH");
  assert.strictEqual(byKey["a1:soon"].title, "Essay is due in 5h");
  assert.strictEqual(byKey["a2:soon"].priority, "MEDIUM");
  assert.strictEqual(byKey["a3:overdue"].title, "Report is past its due date");
  assert.ok(!byKey["a4:soon"]);
});

test("progress milestone uses the highest reached, once per milestone", () => {
  const nudges = engine.detectNudges(context({ courses: [course({ progressPercent: 62 })] }));
  const milestone = nudges.filter((n) => n.type === "PROGRESS_MILESTONE");
  assert.strictEqual(milestone.length, 1);
  assert.strictEqual(milestone[0].dedupeKey, "c1:50");
  assert.ok(milestone[0].sticky);
});

test("revision nudges are capped at 3 and never mention risk", () => {
  const nudges = engine.detectNudges(context({ decayedConcepts: ["Loops", "Arrays", "Classes", "Inheritance"] }));
  const revision = nudges.filter((n) => n.type === "REVISION");
  assert.strictEqual(revision.length, 3);
  for (const n of engine.detectNudges(context({ decayedConcepts: ["Loops"], courses: [course({ health: { inactivityDays: 9, improvementTrend: "IMPROVING" } })] }))) {
    assert.ok(!/risk|critical|dropout/i.test(`${n.title} ${n.message}`), n.title);
  }
});

test("reconcile creates new, refreshes active, never revives dismissed, expires the rest", () => {
  const candidates = [
    { type: "COMEBACK", dedupeKey: "c1:x", priority: "HIGH", title: "T", message: "M", ctaHref: null, courseId: "c1", expiresInHours: 168 },
    { type: "REVISION", dedupeKey: "loops:w", priority: "MEDIUM", title: "Revisit Loops", message: "M", ctaHref: null, courseId: null, expiresInHours: 168 },
    { type: "DEADLINE", dedupeKey: "a1:soon", priority: "HIGH", title: "New title", message: "M", ctaHref: "/student/assignments", courseId: null, expiresInHours: 48 },
  ];
  const existing = [
    { id: "r1", type: "REVISION", dedupeKey: "loops:w", status: "DISMISSED", priority: "MEDIUM", title: "Revisit Loops", message: "M" },
    { id: "r2", type: "DEADLINE", dedupeKey: "a1:soon", status: "ACTIVE", priority: "MEDIUM", title: "Old title", message: "M", ctaHref: "/student/assignments", courseId: null, expiresAt: new Date(NOW.getTime() + 3_600_000) },
    { id: "r3", type: "STREAK_AT_RISK", dedupeKey: "yesterday", status: "ACTIVE", priority: "MEDIUM", title: "x", message: "m", expiresAt: new Date(NOW.getTime() + 3_600_000) },
    { id: "r4", type: "PROGRESS_MILESTONE", dedupeKey: "c1:50", status: "ACTIVE", priority: "LOW", title: "x", message: "m", expiresAt: new Date(NOW.getTime() + 3_600_000) },
    { id: "r5", type: "PROGRESS_MILESTONE", dedupeKey: "c1:25", status: "ACTIVE", priority: "LOW", title: "x", message: "m", expiresAt: new Date(NOW.getTime() - 1) },
  ];

  const { creates, updates, expireIds } = engine.reconcileNudges({ existing, candidates, now: NOW });

  assert.deepStrictEqual(creates.map((c) => c.dedupeKey), ["c1:x"]); // dismissed REVISION not revived
  assert.strictEqual(creates[0].expiresAt.getTime(), NOW.getTime() + 168 * 3_600_000);
  assert.deepStrictEqual(updates, [{ id: "r2", data: { title: "New title", message: "M", priority: "HIGH", ctaHref: "/student/assignments", courseId: null } }]);
  assert.deepStrictEqual(expireIds.sort(), ["r3", "r5"]); // r4 is sticky and unexpired
});

test("visibleNudges: active and unexpired only, priority first, capped at 5", () => {
  const row = (id, priority, overrides = {}) => ({ id, priority, status: "ACTIVE", createdAt: NOW, expiresAt: null, ...overrides });
  const rows = [
    row("low", "LOW"),
    row("high", "HIGH"),
    row("gone", "HIGH", { status: "DISMISSED" }),
    row("stale", "HIGH", { expiresAt: new Date(NOW.getTime() - 1) }),
    row("m1", "MEDIUM"), row("m2", "MEDIUM"), row("m3", "MEDIUM"), row("m4", "MEDIUM"),
  ];
  const visible = engine.visibleNudges(rows, NOW);
  assert.strictEqual(visible.length, 5);
  assert.strictEqual(visible[0].id, "high");
  assert.ok(!visible.some((r) => ["gone", "stale", "low"].includes(r.id)));
});
