const test = require("node:test");
const assert = require("node:assert");

const scoring = require("../src/modules/learning-health/learningHealth.scoring");
const config = require("../src/modules/learning-health/learningHealth.config");

// The invariants under test, for the Learning Health agent's scoring:
//
//  1. Pure: signals in, state out. No database, no clock (`now` is an input).
//  2. Absence of evidence is never a zero — a term with no data is dropped and
//     the remaining weights renormalised (carried over from the original
//     Student State agent's availableWeightedAverage).
//  3. Every risk level is explained by named reasons, most severe first.
//  4. New enrolments and completed courses are not "at risk".

const NOW = new Date("2026-03-01T12:00:00.000Z");
const DAY = 86_400_000;
const daysBefore = (n) => new Date(NOW.getTime() - n * DAY);
const key = (d) => d.toISOString().slice(0, 10);
const activeOn = (...days) => new Set(days.map((n) => key(daysBefore(n))));

const attempt = (percentage, overrides = {}) => ({
  percentage,
  passed: percentage >= 50,
  correctCount: Math.round(percentage / 10),
  incorrectCount: 10 - Math.round(percentage / 10),
  submittedAt: daysBefore(1),
  ...overrides,
});

/** A healthy, active learner. Each test overrides only what it is about. */
const signals = (overrides = {}) => ({
  now: NOW,
  enrolledAt: daysBefore(60),
  completed: false,
  progressPercent: 40,
  lastActivityAt: daysBefore(0),
  hasAnyActivity: true,
  activeDates: activeOn(0, 1, 2, 4, 5, 7, 9, 11),
  videoMinutes: 0,
  courseHasVideo: false,
  quizAttempts: [attempt(85), attempt(80)],
  assignmentScores: [],
  masteryScores: [0.8],
  deadlines: { hasDeadlines: false, overdue: 0, dueSoonDaysLeft: [] },
  ...overrides,
});

test("availableWeightedAverage drops terms without data and renormalises", () => {
  const value = scoring.availableWeightedAverage([
    { value: 80, weight: 0.5, available: true },
    { value: 0, weight: 0.5, available: false },
  ]);
  assert.strictEqual(value, 80);
  assert.strictEqual(
    scoring.availableWeightedAverage([{ value: 10, weight: 1, available: false }]),
    null
  );
});

test("inactivity ramps 0 -> 100 between 7 and 14 days, as in the original agent", () => {
  const at = (days) => scoring.inactivity({ now: NOW, lastActivityAt: daysBefore(days), enrolledAt: daysBefore(60) });
  assert.strictEqual(at(6).inactivityScore, 0);
  assert.strictEqual(at(7).inactivityScore, 0);
  assert.strictEqual(at(14).inactivityScore, 100);
  assert.strictEqual(at(30).inactivityScore, 100);
  // Whole days, as the original counted them: 10.5 days is 10 -> (10-7)/7.
  assert.strictEqual(scoring.inactivity({ now: NOW, lastActivityAt: new Date(NOW.getTime() - 10.5 * DAY), enrolledAt: daysBefore(60) }).inactivityScore, 42.86);
  assert.strictEqual(at(9).inactivityDays, 9);
});

test("risk levels use the original 33/66 cut-offs plus CRITICAL at 85", () => {
  assert.strictEqual(scoring.levelFor(32.99), "LOW");
  assert.strictEqual(scoring.levelFor(33), "MEDIUM");
  assert.strictEqual(scoring.levelFor(65.99), "MEDIUM");
  assert.strictEqual(scoring.levelFor(66), "HIGH");
  assert.strictEqual(scoring.levelFor(85), "CRITICAL");
});

test("an active, well-performing learner is LOW risk", () => {
  const state = scoring.scoreLearner(signals());
  assert.strictEqual(state.riskLevel, "LOW");
  assert.ok(state.riskScore < config.RISK_LEVEL_THRESHOLDS.MEDIUM, `riskScore ${state.riskScore}`);
  assert.strictEqual(state.lastActivityAt.getTime(), NOW.getTime());
  assert.strictEqual(state.inactivityDays, 0);
});

test("a learner silent for 20 days is CRITICAL, and inactivity is the first reason", () => {
  const state = scoring.scoreLearner(
    signals({ lastActivityAt: daysBefore(20), activeDates: new Set(), quizAttempts: [attempt(40, { submittedAt: daysBefore(25) })] })
  );
  assert.strictEqual(state.riskLevel, "CRITICAL");
  assert.strictEqual(state.inactivityDays, 20);
  assert.strictEqual(state.riskReasons[0], "Inactive for 20 days");
});

test("no performance evidence is null, not zero, and produces no performance reason", () => {
  const state = scoring.scoreLearner(signals({ quizAttempts: [], masteryScores: [], assignmentScores: [] }));
  assert.strictEqual(state.performanceScore, null);
  assert.ok(!state.riskReasons.some((r) => /quiz|performance/i.test(r)));
});

test("performance uses the original weights rescaled to 80%, plus mastery at 20%", () => {
  // One attempt at 80%: average 80, pass rate 100, accuracy 8/10 = 80.
  // (80*.32 + 100*.2 + 80*.12) / .64 = 86.25 — no assignments, no mastery.
  const state = scoring.scoreLearner(
    signals({ quizAttempts: [attempt(80, { correctCount: 8, incorrectCount: 2 })], masteryScores: [] })
  );
  assert.strictEqual(state.performanceScore, 86.25);
});

test("an overdue assignment saturates deadline risk and leads the reasons", () => {
  const state = scoring.scoreLearner(
    signals({ deadlines: { hasDeadlines: true, overdue: 1, dueSoonDaysLeft: [] } })
  );
  assert.strictEqual(state.deadlineRisk, 100);
  assert.strictEqual(state.riskReasons[0], "1 assignment overdue");
});

test("an assignment due soon raises deadline risk below the overdue level", () => {
  const state = scoring.scoreLearner(
    signals({ deadlines: { hasDeadlines: true, overdue: 0, dueSoonDaysLeft: [1] } })
  );
  assert.ok(state.deadlineRisk > 0 && state.deadlineRisk < 100, `deadlineRisk ${state.deadlineRisk}`);
  assert.ok(state.riskReasons.includes("1 assignment due within 3 days"));
});

test("a learner enrolled yesterday with no activity is NEW, not at risk", () => {
  const state = scoring.scoreLearner(
    signals({ enrolledAt: daysBefore(1), lastActivityAt: null, hasAnyActivity: false, activeDates: new Set(), quizAttempts: [], masteryScores: [] })
  );
  assert.strictEqual(state.riskLevel, "NEW");
  assert.strictEqual(state.riskScore, 0);
  assert.strictEqual(state.lastActivityAt, null); // "no activity yet", not "last active yesterday"
  assert.deepStrictEqual(state.riskReasons, ["Recently enrolled"]);
});

test("a completed course is pinned LOW with completionProbability 1", () => {
  const state = scoring.scoreLearner(
    signals({ completed: true, progressPercent: 100, lastActivityAt: daysBefore(40), activeDates: new Set() })
  );
  assert.strictEqual(state.riskLevel, "LOW");
  assert.strictEqual(state.riskScore, 0);
  assert.strictEqual(state.completionProbability, 1);
  assert.deepStrictEqual(state.riskReasons, ["Course completed"]);
});

test("improvementTrend compares the newer and older halves of the last 6 attempts", () => {
  const newestFirst = (xs) => xs.map((p) => attempt(p));
  assert.strictEqual(scoring.improvementTrend(newestFirst([40, 45, 50, 80, 85, 90])), "DECLINING");
  assert.strictEqual(scoring.improvementTrend(newestFirst([90, 85, 80, 50, 45, 40])), "IMPROVING");
  assert.strictEqual(scoring.improvementTrend(newestFirst([70, 71, 69, 70])), "STABLE");
  assert.strictEqual(scoring.improvementTrend(newestFirst([10, 90])), "STABLE");
});

test("reasons are capped at 4 and ordered by severity", () => {
  const state = scoring.scoreLearner(
    signals({
      lastActivityAt: daysBefore(10),
      activeDates: activeOn(10),
      quizAttempts: [20, 25, 30, 80, 85, 90].map((p) => attempt(p, { submittedAt: daysBefore(12) })),
      deadlines: { hasDeadlines: true, overdue: 2, dueSoonDaysLeft: [2] },
    })
  );
  assert.ok(state.riskReasons.length <= config.MAX_REASONS);
  assert.strictEqual(state.riskReasons[0], "2 assignments overdue");
  assert.ok(state.riskReasons.includes("Inactive for 10 days"));
});

test("video minutes count toward engagement only when the course has video", () => {
  const without = scoring.scoreLearner(signals({ videoMinutes: 0, courseHasVideo: false }));
  const withVideo = scoring.scoreLearner(signals({ videoMinutes: 0, courseHasVideo: true }));
  assert.ok(withVideo.engagementScore < without.engagementScore);
});
