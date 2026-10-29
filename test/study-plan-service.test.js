process.env.TEST_DATABASE_URL = "postgresql://blocked:blocked@127.0.0.1:9/study_plan_no_db";

const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const service = require("../src/modules/study-plan/studyPlan.service");
const studyPlan = require("../src/modules/study-plan");
const learningHealth = require("../src/modules/learning-health");
const progressService = require("../src/modules/progress/progress.service");
const retentionService = require("../src/modules/learner-model/retention.service");

const NOW = new Date("2026-03-10T15:00:00.000Z");

function stub(t, target, methods) {
  const originals = {};
  for (const [name, fn] of Object.entries(methods)) {
    originals[name] = target[name];
    target[name] = fn;
  }
  t.after(() => Object.assign(target, originals));
}

function stubPlanInputs(t, calls = {}) {
  stub(t, progressService, {
    computeStudentSequence: async (studentId, courseId, options) => {
      calls.sequence = { studentId, courseId, options };
      return {
        sequence: {
          steps: [
            { index: 0, contentId: "v0", kind: "CONTENT", type: "VIDEO", title: "Intro", completed: true },
            { index: 1, contentId: "v1", kind: "CONTENT", type: "VIDEO", title: "Classes", completed: false },
            { index: 2, contentId: "q1", kind: "QUIZ", type: "QUIZ", title: "Quiz 1", completed: false, questionCount: 10 },
          ],
        },
      };
    },
  });
  stub(t, prisma.studentProfile, { findUnique: async () => ({ weeklyStudyHours: 7 }) });
  stub(t, learningHealth, { getState: async () => ({ performanceScore: 70, improvementTrend: "STABLE" }) });
  stub(t, retentionService, { getLearningSignals: async () => ({ signals: [], calibration: null }) });
  stub(t, prisma.content, {
    findMany: async ({ where }) => {
      calls.durationIds = where.id.in;
      return [{ id: "v1", duration: 1200 }];
    },
  });
  stub(t, prisma.studyPlan, {
    upsert: async (args) => {
      calls.upsert = args;
      return { courseId: "course-1", ...args.create };
    },
  });
}

test("recomputePlan reads the sequence read-only and stores a budgeted plan", async (t) => {
  const calls = {};
  stubPlanInputs(t, calls);
  const events = [];
  t.after(studyPlan.subscribe(studyPlan.STUDY_PLAN_EVENT_NAMES.PLAN_UPDATED, (p) => events.push(p)));

  await service.recomputePlan("s1", "course-1", { now: NOW });
  await new Promise(setImmediate);

  assert.deepStrictEqual(calls.sequence.options, { persist: false }); // never writes progress
  assert.deepStrictEqual(calls.durationIds, ["v1", "q1"]); // only remaining steps
  const saved = calls.upsert.create;
  assert.strictEqual(saved.dailyMinutes, 60);
  assert.strictEqual(saved.remainingSteps, 2);
  assert.strictEqual(saved.remainingMinutes, 20 + 15); // 1200s video + 10 questions x 1.5
  assert.deepStrictEqual(saved.days[0].items.map((i) => i.title), ["Classes", "Quiz 1"]);
  assert.deepStrictEqual(calls.upsert.where, { studentId_courseId: { studentId: "s1", courseId: "course-1" } });
  assert.strictEqual(events.length, 1);
});

test("getMyPlan: not enrolled is 404; a fresh stored plan is returned without recomputing", async (t) => {
  stub(t, prisma.studentProfile, { findUnique: async () => ({ id: "s1" }) });
  stub(t, prisma.enrollment, { findUnique: async ({ where }) => (where.studentId_courseId.courseId === "mine" ? { id: "e1" } : null) });
  let recomputed = false;
  stub(t, progressService, { computeStudentSequence: async () => { recomputed = true; return { sequence: { steps: [] } }; } });
  stub(t, prisma.studyPlan, {
    findUnique: async () => ({ courseId: "mine", dailyMinutes: 30, adjustment: "STANDARD", remainingSteps: 1, remainingMinutes: 8, days: [], computedAt: new Date(NOW.getTime() - 3_600_000) }),
  });

  await assert.rejects(service.getMyPlan({ id: "u1" }, { courseId: "not-mine", now: NOW }), (e) => e.statusCode === 404);
  const plan = await service.getMyPlan({ id: "u1" }, { courseId: "mine", now: NOW });
  assert.strictEqual(plan.dailyMinutes, 30);
  assert.strictEqual(recomputed, false);
});

test("getMyPlan recomputes a plan older than a day", async (t) => {
  const calls = {};
  stubPlanInputs(t, calls);
  stub(t, prisma.studentProfile, {
    findUnique: async ({ where }) => (where.userId ? { id: "s1" } : { weeklyStudyHours: 7 }),
  });
  stub(t, prisma.enrollment, { findUnique: async () => ({ id: "e1" }) });
  const old = { courseId: "course-1", computedAt: new Date(NOW.getTime() - 25 * 3_600_000) };
  stub(t, prisma.studyPlan, {
    findUnique: async () => old,
    upsert: async (args) => {
      calls.upsert = args;
      return { courseId: "course-1", ...args.create };
    },
  });

  const plan = await service.getMyPlan({ id: "u1" }, { courseId: "course-1", now: NOW });
  assert.ok(calls.upsert, "recomputed");
  assert.strictEqual(plan.remainingSteps, 2);
});

test("getPlan never throws", async (t) => {
  stub(t, prisma.studyPlan, { findUnique: async () => { throw new Error("db down"); }, findMany: async () => { throw new Error("db down"); } });
  stub(t, console, { warn: () => {} });
  assert.strictEqual(await studyPlan.getPlan("s1", "c1"), null);
  assert.deepStrictEqual(await studyPlan.getBatchPlans("c1", ["s1"]), []);
});
