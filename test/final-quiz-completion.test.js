const test = require("node:test");
const assert = require("node:assert");

const { summarizeQuizAttempts, isQuizComplete, completionHint } = require("../src/utils/itemCompletion");
const { buildLearningSequence } = require("../src/utils/learningSequence");

// A Final the student failed on their last attempt is done for progression —
// they move on — but stays not passed. Pure: no database.

const failed = { passed: false, submittedAt: new Date("2026-10-01") };
const passed = { passed: true, submittedAt: new Date("2026-10-02") };
const done = (tag, attempts, maxAttempts, latest = null) =>
  isQuizComplete(tag, summarizeQuizAttempts(attempts, latest, 50), maxAttempts);

test("a Final failed on its only attempt is complete", () => {
  assert.strictEqual(done("FINAL", [failed], 1), true);
});

test("a Final failed with attempts left is not complete", () => {
  assert.strictEqual(done("FINAL", [failed], 3), false);
  assert.strictEqual(done("FINAL", [failed, failed], 3), false);
});

test("a Final failed on its last of several attempts is complete", () => {
  assert.strictEqual(done("FINAL", [failed, failed, failed], 3), true);
});

test("a passed Final is complete whatever the allowance", () => {
  assert.strictEqual(done("FINAL", [failed, passed], 3), true);
});

test("a Final with unlimited attempts completes only on a pass", () => {
  assert.strictEqual(done("FINAL", [failed, failed, failed, failed], 0), false);
});

test("an unattempted Final is not complete, even with a limit of 1", () => {
  assert.strictEqual(done("FINAL", [], 1), false);
});

test("a legacy submission with no attempt log counts as the first attempt", () => {
  assert.strictEqual(done("FINAL", [], 1, { passed: false, percentage: 20 }), true);
});

test("a Self-Test is still complete once attempted, pass or fail", () => {
  assert.strictEqual(done("SELF_TEST", [failed], 1), true);
});

test("without the allowance a Final still needs a pass (older callers)", () => {
  assert.strictEqual(isQuizComplete("FINAL", summarizeQuizAttempts([failed], null, 50)), false);
});

test("the hint says a Final can be finished by using its attempts", () => {
  assert.strictEqual(completionHint("QUIZ", "FINAL"), "Pass this quiz, or use all its attempts, to continue.");
});

test("the step after a Final failed on its last attempt opens; the Final shows not passed", () => {
  const final = { completed: done("FINAL", [failed], 1), passed: false, attemptsUsed: 1, attempted: true };
  const hierarchy = {
    id: "c1",
    items: [
      { contentId: "f", kind: "QUIZ", type: "QUIZ", order: 1, quizTag: "FINAL", ...final },
      { contentId: "n", kind: "CONTENT", type: "VIDEO", order: 2, completed: false }
    ],
    modules: []
  };
  const { steps } = buildLearningSequence(hierarchy);
  assert.deepStrictEqual(
    steps.map((s) => [s.contentId, s.completed, s.passed, s.locked]),
    [["f", true, false, false], ["n", false, null, false]]
  );
});
