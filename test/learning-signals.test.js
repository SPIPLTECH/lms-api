const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const retention = require("../src/modules/learner-model/retention.service");
const learnerModelService = require("../src/modules/learner-model/learnerModel.service");
const { RETENTION_CONFIG } = require("../src/modules/learner-model/retention.config");

const {
  RETENTION_STATUS,
  TRANSFER_STATUS,
  CALIBRATION_STATUS,
  evaluateRetention,
  evaluateTransfer,
  evaluateCalibration
} = retention;

// The invariants under test, for Phase 8:
//
//  1. Every signal is a PURE FUNCTION of counts the database produced. Same
//     rows in, same answer out — no scoring, no model, no LLM.
//  2. Nothing is claimed without evidence to claim it with. "I don't know"
//     is a first-class answer and must not quietly become "fine".
//  3. Retention is about DELAYED evidence. Two correct answers in one sitting
//     say nothing about durability and must never read as RETAINED.
//  4. Transfer is not repetition. The same question answered right twice is
//     not evidence of applying a concept somewhere new.
//  5. Calibration reports UNAVAILABLE while nothing captures confidence, and
//     must not be fabricated from anything else.
//  6. A student can only ever reach their own signals.

const STUDENT = { id: "student-1", userId: "user-1" };
const NOW = new Date("2026-03-01T12:00:00.000Z");
const daysBefore = (n) => new Date(NOW.getTime() - n * 86_400_000);

/** One concept's aggregated counts, as fetchConceptSignalRows returns them. */
const row = (overrides = {}) => ({
  concept: "Inheritance",
  answered: 4,
  correct: 3,
  distinctSeen: 3,
  distinctCorrectQuestions: 2,
  distinctCorrectQuizzes: 2,
  lastSeenAt: daysBefore(1),
  firstCorrectAt: daysBefore(20),
  delayedAnswered: 3,
  delayedCorrect: 3,
  ...overrides
});

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

test("a concept answered right repeatedly after a gap is RETAINED", async () => {
  const result = evaluateRetention(row({ delayedAnswered: 3, delayedCorrect: 3 }), NOW);

  assert.strictEqual(result.status, RETENTION_STATUS.RETAINED);
  assert.strictEqual(result.retentionRate, 1);
  assert.strictEqual(result.gapDays, RETENTION_CONFIG.GAP_DAYS, "the rule states its own gap");
});

test("a concept that was right then went wrong after a gap is DECAYED", async () => {
  const result = evaluateRetention(row({ delayedAnswered: 3, delayedCorrect: 0 }), NOW);

  assert.strictEqual(result.status, RETENTION_STATUS.DECAYED);
  assert.strictEqual(result.retentionRate, 0);
  assert.strictEqual(result.dueForReview, false, "already decayed is a live problem, not a nudge");
});

test("mixed delayed evidence is SHAKY, not rounded to either extreme", async () => {
  const result = evaluateRetention(row({ delayedAnswered: 4, delayedCorrect: 2 }), NOW);

  assert.strictEqual(result.status, RETENTION_STATUS.SHAKY);
  assert.strictEqual(result.retentionRate, 0.5);
});

test("two correct answers in one sitting are NOT retention", async () => {
  // This is invariant 3, and the single most tempting wrong answer available:
  // the student looks great, but nothing here has survived a break.
  const result = evaluateRetention(
    row({ answered: 2, correct: 2, delayedAnswered: 0, delayedCorrect: 0 }),
    NOW
  );

  assert.strictEqual(result.status, RETENTION_STATUS.INSUFFICIENT_EVIDENCE);
  assert.strictEqual(result.retentionRate, null, "no rate is reported from no delayed evidence");
});

test("a single delayed answer is not enough to classify either way", async () => {
  const result = evaluateRetention(row({ delayedAnswered: 1, delayedCorrect: 0 }), NOW);

  assert.strictEqual(result.status, RETENTION_STATUS.INSUFFICIENT_EVIDENCE);
});

test("a concept never answered correctly has no retention to measure", async () => {
  const result = evaluateRetention(
    row({ correct: 0, distinctCorrectQuestions: 0, distinctCorrectQuizzes: 0, firstCorrectAt: null, delayedAnswered: 0, delayedCorrect: 0 }),
    NOW
  );

  assert.strictEqual(result.status, RETENTION_STATUS.INSUFFICIENT_EVIDENCE);
  assert.strictEqual(result.dueForReview, false, "unlearned is not due for review");
});

test("a demonstrated concept untouched for a fortnight is due for review", async () => {
  const result = evaluateRetention(
    row({ lastSeenAt: daysBefore(RETENTION_CONFIG.REVIEW_DUE_DAYS + 1), delayedAnswered: 0, delayedCorrect: 0 }),
    NOW
  );

  assert.strictEqual(result.status, RETENTION_STATUS.INSUFFICIENT_EVIDENCE);
  assert.strictEqual(result.dueForReview, true);
  assert.ok(result.daysSinceLastSeen >= RETENTION_CONFIG.REVIEW_DUE_DAYS);
});

test("a concept worked on yesterday is not due for review", async () => {
  const result = evaluateRetention(row({ lastSeenAt: daysBefore(1) }), NOW);
  assert.strictEqual(result.dueForReview, false);
});

// ---------------------------------------------------------------------------
// Transfer
// ---------------------------------------------------------------------------

test("correct on different questions in different quizzes is TRANSFERRED", async () => {
  const result = evaluateTransfer(row({ distinctCorrectQuestions: 2, distinctCorrectQuizzes: 2 }));
  assert.strictEqual(result.status, TRANSFER_STATUS.TRANSFERRED);
});

test("the same question answered right twice is REPEATED_ONLY, not transfer", async () => {
  // Invariant 4. Two correct answers, one question — the student has repeated
  // themselves, not applied anything.
  const result = evaluateTransfer(
    row({ correct: 2, distinctSeen: 2, distinctCorrectQuestions: 1, distinctCorrectQuizzes: 2 })
  );

  assert.strictEqual(result.status, TRANSFER_STATUS.REPEATED_ONLY);
});

test("different questions inside one quiz is still one context, so REPEATED_ONLY", async () => {
  const result = evaluateTransfer(
    row({ distinctSeen: 3, distinctCorrectQuestions: 3, distinctCorrectQuizzes: 1 })
  );

  assert.strictEqual(result.status, TRANSFER_STATUS.REPEATED_ONLY);
});

test("seeing only one question on a concept is INSUFFICIENT_EVIDENCE, not failure", async () => {
  const result = evaluateTransfer(
    row({ answered: 1, correct: 1, distinctSeen: 1, distinctCorrectQuestions: 1, distinctCorrectQuizzes: 1 })
  );

  assert.strictEqual(result.status, TRANSFER_STATUS.INSUFFICIENT_EVIDENCE);
});

test("never getting the concept right is NOT_DEMONSTRATED", async () => {
  const result = evaluateTransfer(
    row({ correct: 0, distinctSeen: 3, distinctCorrectQuestions: 0, distinctCorrectQuizzes: 0 })
  );

  assert.strictEqual(result.status, TRANSFER_STATUS.NOT_DEMONSTRATED);
});

// ---------------------------------------------------------------------------
// Calibration — no confidence data exists in this codebase
// ---------------------------------------------------------------------------

test("with no confidence data, calibration is UNAVAILABLE and says why", async () => {
  const result = evaluateCalibration([]);

  assert.strictEqual(result.status, CALIBRATION_STATUS.UNAVAILABLE);
  assert.strictEqual(result.observations, 0);
  assert.match(result.note, /not captured/i, "the absence is explained, not hidden");
});

test("calibration ignores observations that carry no confidence", async () => {
  const result = evaluateCalibration([
    { isCorrect: true },
    { isCorrect: false },
    { isCorrect: true },
    { isCorrect: true }
  ]);

  assert.strictEqual(result.status, CALIBRATION_STATUS.UNAVAILABLE);
  assert.strictEqual(result.observations, 0, "a missing field is not a zero");
});

test("high confidence with repeated wrong answers is OVERCONFIDENT, once data exists", async () => {
  const result = evaluateCalibration([
    { confidence: 5, isCorrect: false },
    { confidence: 5, isCorrect: false },
    { confidence: 4, isCorrect: false },
    { confidence: 4, isCorrect: true }
  ]);

  assert.strictEqual(result.status, CALIBRATION_STATUS.OVERCONFIDENT);
  assert.strictEqual(result.confidentAccuracy, 0.25);
});

test("low confidence with consistently right answers is UNDERCONFIDENT", async () => {
  const result = evaluateCalibration([
    { confidence: 1, isCorrect: true },
    { confidence: 2, isCorrect: true },
    { confidence: 2, isCorrect: true },
    { confidence: 1, isCorrect: true }
  ]);

  assert.strictEqual(result.status, CALIBRATION_STATUS.UNDERCONFIDENT);
});

test("matching confidence and correctness is WELL_CALIBRATED", async () => {
  const result = evaluateCalibration([
    { confidence: 5, isCorrect: true },
    { confidence: 5, isCorrect: true },
    { confidence: 4, isCorrect: true },
    { confidence: 5, isCorrect: true },
    { confidence: 1, isCorrect: false }
  ]);

  assert.strictEqual(result.status, CALIBRATION_STATUS.WELL_CALIBRATED);
});

// ---------------------------------------------------------------------------
// getLearningSignals — ordering, wording, and what never leaks
// ---------------------------------------------------------------------------

function stubRows(t, rows) {
  const original = retention.fetchConceptSignalRows;
  t.after(() => {
    retention.fetchConceptSignalRows = original;
  });
  retention.fetchConceptSignalRows = async () => rows;
}

test("a brand-new learner gets an empty list, not filler", async (t) => {
  stubRows(t, []);

  const result = await retention.getLearningSignals(STUDENT, { courseId: "course-1", now: NOW });

  assert.deepStrictEqual(result.signals, []);
  assert.strictEqual(result.calibration.status, CALIBRATION_STATUS.UNAVAILABLE);
});

test("the most actionable concept is listed first, and ordering is total", async (t) => {
  stubRows(t, [
    row({ concept: "Retained Thing", delayedAnswered: 3, delayedCorrect: 3 }),
    row({ concept: "Decayed Thing", delayedAnswered: 3, delayedCorrect: 0 }),
    row({ concept: "Shaky Thing", delayedAnswered: 4, delayedCorrect: 2 })
  ]);

  const { signals } = await retention.getLearningSignals(STUDENT, { now: NOW });

  assert.deepStrictEqual(
    signals.map((s) => s.concept),
    ["Decayed Thing", "Shaky Thing", "Retained Thing"]
  );
});

test("every signal carries wording a student can read, and no internal numbers", async (t) => {
  stubRows(t, [
    row({ concept: "Decayed Thing", delayedAnswered: 3, delayedCorrect: 0 }),
    row({ concept: "Retained Thing", delayedAnswered: 3, delayedCorrect: 3 })
  ]);

  const { signals } = await retention.getLearningSignals(STUDENT, { now: NOW });

  for (const signal of signals) {
    assert.ok(signal.label && signal.label.length > 0, "a human-readable label");
    assert.ok(signal.detail && signal.detail.length > 0, "and a sentence explaining it");
  }

  const json = JSON.stringify(signals);
  assert.ok(!json.includes("masteryScore"));
  assert.ok(!json.includes("masteryProbability"));
  assert.ok(!json.includes("confidenceLevel"));
  assert.ok(!json.includes("question:"), "no synthetic knowledge-component ids");
});

test("a reliable-but-repetitive concept is told to practise, not congratulated", async (t) => {
  stubRows(t, [
    row({
      concept: "Loops",
      delayedAnswered: 3,
      delayedCorrect: 3,
      distinctSeen: 2,
      distinctCorrectQuestions: 1,
      distinctCorrectQuizzes: 2
    })
  ]);

  const { signals } = await retention.getLearningSignals(STUDENT, { now: NOW });

  assert.strictEqual(signals[0].retention.status, RETENTION_STATUS.RETAINED);
  assert.strictEqual(signals[0].transfer.status, TRANSFER_STATUS.REPEATED_ONLY);
  assert.match(signals[0].label, /Practice applying/i);
});

test("the same rows always produce the same answer", async (t) => {
  const rows = [
    row({ concept: "A", delayedAnswered: 3, delayedCorrect: 0 }),
    row({ concept: "B", delayedAnswered: 3, delayedCorrect: 3 })
  ];
  stubRows(t, rows);

  const first = await retention.getLearningSignals(STUDENT, { now: NOW });
  const second = await retention.getLearningSignals(STUDENT, { now: NOW });

  assert.deepStrictEqual(first, second, "deterministic, with no hidden state between calls");
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

test("a student cannot read another student's signals by changing the id", async (t) => {
  const original = prisma.studentProfile.findUnique;
  t.after(() => {
    prisma.studentProfile.findUnique = original;
  });
  prisma.studentProfile.findUnique = async () => ({ id: "student-1", userId: "user-1" });

  await assert.rejects(
    () =>
      learnerModelService.resolveStudentProfile({
        callingUser: { id: "user-1", role: "STUDENT" },
        targetStudentId: "student-2"
      }),
    (error) => error.statusCode === 403
  );
});

test("a student asking for their own signals is allowed", async (t) => {
  const original = prisma.studentProfile.findUnique;
  t.after(() => {
    prisma.studentProfile.findUnique = original;
  });
  prisma.studentProfile.findUnique = async () => ({ id: "student-1", userId: "user-1" });

  const profile = await learnerModelService.resolveStudentProfile({
    callingUser: { id: "user-1", role: "STUDENT" },
    targetStudentId: "student-1"
  });

  assert.strictEqual(profile.id, "student-1");
});

test("the signal query is scoped to one student and one course", async (t) => {
  // The scan must never be able to read across students. This pins the two
  // bound parameters rather than the SQL text, so the query can be rewritten
  // without the test becoming a transcription of it.
  let captured = null;
  const original = prisma.$queryRaw;
  t.after(() => {
    prisma.$queryRaw = original;
  });
  prisma.$queryRaw = async (strings, ...values) => {
    captured = values;
    return [];
  };

  await retention.fetchConceptSignalRows("student-1", "course-1");

  assert.ok(captured.includes("student-1"), "bound to the resolved student");
  assert.ok(captured.includes("course-1"), "and to the requested course");
  assert.ok(
    captured.includes(RETENTION_CONFIG.GAP_DAYS),
    "the gap is a bound parameter, not interpolated text"
  );
});

// ---------------------------------------------------------------------------
// REPEATED_ONLY has two causes, and they are different facts about the
// student's own history. Saying the wrong one is a small lie they can catch.
// ---------------------------------------------------------------------------

test("correct answers spread over questions but stuck in one quiz says so", async (t) => {
  stubRows(t, [
    row({
      concept: "Data Types",
      distinctSeen: 2,
      distinctCorrectQuestions: 2,
      distinctCorrectQuizzes: 1,
      delayedAnswered: 0,
      delayedCorrect: 0
    })
  ]);

  const { signals } = await retention.getLearningSignals(STUDENT, { now: NOW });

  assert.strictEqual(signals[0].transfer.status, TRANSFER_STATUS.REPEATED_ONLY);
  assert.match(signals[0].detail, /same quiz/i);
  assert.ok(!/same question/i.test(signals[0].detail), "two distinct questions is not one question");
});

test("correct answers stuck on a single question says THAT instead", async (t) => {
  stubRows(t, [
    row({
      concept: "Variables",
      correct: 2,
      distinctSeen: 2,
      distinctCorrectQuestions: 1,
      distinctCorrectQuizzes: 2,
      delayedAnswered: 0,
      delayedCorrect: 0
    })
  ]);

  const { signals } = await retention.getLearningSignals(STUDENT, { now: NOW });

  assert.strictEqual(signals[0].transfer.status, TRANSFER_STATUS.REPEATED_ONLY);
  assert.match(signals[0].detail, /same question/i);
});

test("a retained but repetitive concept still names the right limitation", async (t) => {
  stubRows(t, [
    row({
      concept: "Loops",
      delayedAnswered: 3,
      delayedCorrect: 3,
      distinctSeen: 2,
      distinctCorrectQuestions: 2,
      distinctCorrectQuizzes: 1
    })
  ]);

  const { signals } = await retention.getLearningSignals(STUDENT, { now: NOW });

  assert.match(signals[0].label, /Practice applying/i);
  assert.match(signals[0].detail, /same quiz/i);
});
