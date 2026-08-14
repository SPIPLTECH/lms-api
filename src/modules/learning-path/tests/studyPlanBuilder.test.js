const test = require("node:test");
const assert = require("node:assert/strict");

const { buildWeeklyPlan, buildDailyPlan } = require("../services/domain/studyPlanBuilder");

test("buildWeeklyPlan returns exactly 7 days", () => {
  const days = buildWeeklyPlan([], 30, new Date());
  assert.equal(days.length, 7);
});

test("buildWeeklyPlan buckets items into a day until the budget is met, never splitting a lesson", () => {
  const remaining = [
    { lessonId: "a", estimatedMinutes: 20 },
    { lessonId: "b", estimatedMinutes: 20 },
    { lessonId: "c", estimatedMinutes: 20 },
  ];
  const days = buildWeeklyPlan(remaining, 30, new Date());
  // day 0: a(20) -> under 30, adds b(20) -> 40 >= 30, stops. day 1: c.
  assert.deepEqual(
    days[0].items.map((i) => i.lessonId),
    ["a", "b"]
  );
  assert.equal(days[0].totalMinutes, 40);
  assert.deepEqual(
    days[1].items.map((i) => i.lessonId),
    ["c"]
  );
});

test("buildWeeklyPlan gives a day at least one item even if it alone exceeds the budget", () => {
  const remaining = [{ lessonId: "huge", estimatedMinutes: 500 }];
  const days = buildWeeklyPlan(remaining, 30, new Date());
  assert.equal(days[0].items.length, 1);
  assert.equal(days[0].totalMinutes, 500);
});

test("buildWeeklyPlan leaves later days empty once every item is scheduled", () => {
  const remaining = [{ lessonId: "only", estimatedMinutes: 10 }];
  const days = buildWeeklyPlan(remaining, 30, new Date());
  assert.deepEqual(days[1].items, []);
  assert.equal(days[1].totalMinutes, 0);
});

test("buildDailyPlan is exactly day-zero of the weekly plan", () => {
  const remaining = [{ lessonId: "a", estimatedMinutes: 10 }];
  const days = buildWeeklyPlan(remaining, 30, new Date());
  assert.deepEqual(buildDailyPlan(days), days[0]);
});
