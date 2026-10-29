const test = require("node:test");
const assert = require("node:assert");

const engine = require("../src/modules/study-plan/studyPlan.engine");

// The invariants under test, for the Learning Path agent's study plan:
//
//  1. The course's own sequence order is kept; completed steps are skipped.
//  2. Each day is filled up to the learner's own budget (original greedy
//     bucketing), always at least one item while any remain.
//  3. Pace follows the original thresholds; revision comes first on day 1.

const NOW = new Date("2026-03-10T15:00:00.000Z");

const step = (index, overrides = {}) => ({
  index,
  contentId: `c${index}`,
  kind: "CONTENT",
  type: "TEXT",
  title: `Step ${index}`,
  completed: false,
  ...overrides,
});

test("step estimates: video from seconds, quiz from time limit or questions, assignment fixed", () => {
  assert.strictEqual(engine.estimateStepMinutes(step(0, { type: "VIDEO" }), 600), 10);
  assert.strictEqual(engine.estimateStepMinutes(step(0, { type: "VIDEO" }), null), 10);
  assert.strictEqual(engine.estimateStepMinutes(step(0, { kind: "QUIZ", timeLimit: 20 }), null), 20);
  assert.strictEqual(engine.estimateStepMinutes(step(0, { kind: "QUIZ", questionCount: 10 }), null), 15);
  assert.strictEqual(engine.estimateStepMinutes(step(0, { kind: "ASSIGNMENT" }), null), 30);
  assert.strictEqual(engine.estimateStepMinutes(step(0, { type: "PDF" }), null), 8);
  assert.strictEqual(engine.estimateStepMinutes(step(0, { type: "VIDEO" }), 60 * 60 * 5), 120); // capped
});

test("daily budget comes from weekly hours, defaulting to the original 30 minutes", () => {
  assert.strictEqual(engine.dailyBudget(7), 60);
  assert.strictEqual(engine.dailyBudget(null), 30);
  assert.strictEqual(engine.dailyBudget(0.5), 10); // floor
});

test("pace: ease up below 50, accelerate at 80+ only when improving", () => {
  assert.strictEqual(engine.paceAdjustment({ performanceScore: 40 }).adjustment, "EASE_UP");
  assert.strictEqual(engine.paceAdjustment({ performanceScore: 90, improvementTrend: "IMPROVING" }).adjustment, "ACCELERATE");
  assert.strictEqual(engine.paceAdjustment({ performanceScore: 90, improvementTrend: "STABLE" }).adjustment, "STANDARD");
  assert.strictEqual(engine.paceAdjustment({ performanceScore: null }).adjustment, "STANDARD");
  assert.strictEqual(engine.paceAdjustment(null).adjustment, "STANDARD");
});

test("plan keeps sequence order, skips completed steps and fills days to the budget", () => {
  const steps = [step(0, { completed: true }), ...Array.from({ length: 10 }, (_, i) => step(i + 1))]; // 10 x 8 min
  const plan = engine.buildPlan({
    courseId: "course-1",
    steps,
    durations: new Map(),
    weeklyStudyHours: null, // 30 min/day
    health: null,
    decayedConcepts: [],
    now: NOW,
  });

  assert.strictEqual(plan.dailyMinutes, 30);
  assert.strictEqual(plan.remainingSteps, 10);
  assert.strictEqual(plan.remainingMinutes, 80);
  assert.strictEqual(plan.days.length, 7);
  assert.deepStrictEqual(plan.days[0].items.map((i) => i.stepIndex), [1, 2, 3]); // 24 min; a 4th would exceed 30
  assert.strictEqual(plan.days[0].date, "2026-03-10");
  assert.deepStrictEqual(plan.days[3].items.map((i) => i.stepIndex), [10]);
  assert.strictEqual(plan.days[4].items.length, 0);
  assert.strictEqual(plan.estimatedCompletionAt.toISOString(), "2026-03-12T00:00:00.000Z"); // ceil(80/30)=3 days
  assert.ok(plan.days[0].items.every((i) => i.href === "/student/learn/course-1"));
});

test("an item longer than the budget still gets a day of its own", () => {
  const plan = engine.buildPlan({
    courseId: "c",
    steps: [step(0, { kind: "ASSIGNMENT" }), step(1)],
    durations: new Map(),
    weeklyStudyHours: 1.2, // 10 min/day
    health: null,
    decayedConcepts: [],
    now: NOW,
  });
  assert.deepStrictEqual(plan.days[0].items.map((i) => i.stepIndex), [0]);
  assert.deepStrictEqual(plan.days[1].items.map((i) => i.stepIndex), [1]);
});

test("revision for fading concepts comes first, capped at two", () => {
  const plan = engine.buildPlan({
    courseId: "c",
    steps: [step(0)],
    durations: new Map(),
    weeklyStudyHours: 7,
    health: { performanceScore: 40 },
    decayedConcepts: ["Loops", "Arrays", "Classes"],
    now: NOW,
  });
  assert.strictEqual(plan.adjustment, "EASE_UP");
  assert.strictEqual(plan.dailyMinutes, 48); // 60 x 0.8
  assert.deepStrictEqual(plan.days[0].items.map((i) => i.kind), ["REVISION", "REVISION", "LEARN"]);
  assert.strictEqual(plan.days[0].items[0].title, "Review Loops");
});

test("a finished course has no remaining work and no completion date", () => {
  const plan = engine.buildPlan({
    courseId: "c",
    steps: [step(0, { completed: true })],
    durations: new Map(),
    weeklyStudyHours: null,
    health: null,
    decayedConcepts: [],
    now: NOW,
  });
  assert.strictEqual(plan.remainingSteps, 0);
  assert.strictEqual(plan.estimatedCompletionAt, null);
  assert.ok(plan.days.every((d) => d.items.length === 0));
});
