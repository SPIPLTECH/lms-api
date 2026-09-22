const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const progressService = require("../src/modules/progress/progress.service");
const recommendationService = require("../src/modules/learner-model/recommendation.service");
const nextAction = require("../src/modules/learner-model/nextAction.service");

const { NEXT_ACTION } = nextAction;

// The invariants under test, for the student's primary next action:
//
//  1. It is CHOSEN by a fixed priority table over decisions that already
//     exist — the learning path, the deterministic decision engine, and the
//     qualification rules. Nothing here scores or infers.
//  2. Exactly one primary action, always, with a reason a student can read.
//  3. A failed qualifying test sends the student to the LESSON, not back at
//     the test — the retry stays available as a secondary.
//  4. Retake eligibility is the server's answer, never recomputed.
//  5. Every action points somewhere the path says is reachable.

const STUDENT = { id: "student-1", userId: "user-1" };
const COURSE = "course-1";

const pathEntry = (overrides = {}) => ({
  kind: "TOPIC",
  id: "t1",
  title: "Java Inheritance",
  moduleId: "m1",
  lessonId: "l1",
  topicId: "t1",
  status: "AVAILABLE",
  locked: false,
  completed: false,
  qualified: false,
  satisfied: false,
  applicable: true,
  skippable: false,
  qualifyingQuiz: null,
  ...overrides
});

const recommendation = (overrides = {}) => ({
  id: "concept:Inheritance",
  type: "REVIEW_CONCEPT",
  concept: "Inheritance",
  title: "Review Java Inheritance",
  reason: "You missed 3 questions on this topic in recent quizzes.",
  action: { kind: "REVIEW_TOPIC", label: "Review Topic" },
  masteryLabel: "Needs practice",
  priority: "HIGH",
  target: { kind: "TOPIC", topicId: "t9", lessonId: "l9", moduleId: "m9", title: "Java Inheritance" },
  evidence: { questionsAsked: 5, incorrect: 3, skipped: 0, hintsUsed: 0 },
  ...overrides
});

/** Stubs the two aggregated sources plus the qualifying attempt log. */
function stubSources(t, { path = [], recommendations = [], attempts = [] }) {
  const originals = {
    learningPath: progressService.getStudentLearningPath,
    recs: recommendationService.getRecommendations,
    attemptFindMany: prisma.quizAttempt.findMany
  };

  t.after(() => {
    progressService.getStudentLearningPath = originals.learningPath;
    recommendationService.getRecommendations = originals.recs;
    prisma.quizAttempt.findMany = originals.attemptFindMany;
  });

  progressService.getStudentLearningPath = async () => path;
  recommendationService.getRecommendations = async () => ({
    recommendations,
    weakAreas: [],
    masteryOverview: []
  });
  prisma.quizAttempt.findMany = async () => attempts;
}

const run = () => nextAction.getNextAction(STUDENT, { courseId: COURSE });

// ---------------------------------------------------------------------------
// Guard rails
// ---------------------------------------------------------------------------

test("a missing courseId is rejected before any work happens", async () => {
  await assert.rejects(
    () => nextAction.getNextAction(STUDENT, {}),
    (error) => error.statusCode === 400
  );
});

test("there is always exactly one primary action, with a reason", async (t) => {
  stubSources(t, { path: [pathEntry({ status: "CURRENT" })] });

  const result = await run();

  assert.ok(result.primary, "a primary action is always present");
  assert.ok(result.primary.action, "and it is named");
  assert.ok(result.primary.reason.length > 0, "and explained");
  assert.ok(Array.isArray(result.secondary), "secondary offers are a list");
});

// ---------------------------------------------------------------------------
// Course completion
// ---------------------------------------------------------------------------

test("everything settled means the course is complete", async (t) => {
  stubSources(t, {
    path: [
      pathEntry({ id: "l1", satisfied: true, completed: true, status: "COMPLETED" }),
      pathEntry({ id: "l2", satisfied: true, qualified: true, status: "QUALIFIED" })
    ],
    // Even with an outstanding recommendation, a finished course is finished.
    recommendations: [recommendation()]
  });

  const { primary, qualifiedCount } = await run();

  assert.strictEqual(primary.action, NEXT_ACTION.COURSE_COMPLETED);
  assert.strictEqual(qualifiedCount, 1, "qualified lessons are counted separately from completed ones");
});

test("a node with nothing trackable does not hold the course open", async (t) => {
  stubSources(t, {
    path: [
      pathEntry({ id: "l1", satisfied: true, completed: true }),
      // An empty topic can never become satisfied; it must not block completion.
      pathEntry({ id: "l2", applicable: false, satisfied: false })
    ]
  });

  assert.strictEqual((await run()).primary.action, NEXT_ACTION.COURSE_COMPLETED);
});

// ---------------------------------------------------------------------------
// Adaptive signal outranks carrying on
// ---------------------------------------------------------------------------

test("a high-priority adaptive signal becomes the primary action", async (t) => {
  stubSources(t, {
    path: [pathEntry({ status: "CURRENT" })],
    recommendations: [recommendation({ priority: "HIGH" })]
  });

  const { primary, secondary } = await run();

  assert.strictEqual(primary.action, NEXT_ACTION.REVIEW_TOPIC);
  assert.strictEqual(primary.title, "Review Java Inheritance");
  assert.match(primary.reason, /missed 3 questions/i, "the engine's own student-facing reason is used");
  assert.strictEqual(primary.target.topicId, "t9");
  // Carrying on is still offered, just not as the headline.
  assert.strictEqual(secondary[0].action, NEXT_ACTION.CONTINUE_LEARNING);
});

test("a single wrong answer does not get to headline the page", async (t) => {
  // Found in the running app: one missed question on Polymorphism produced a
  // dominant "YOUR NEXT STEP — Review Polymorphism" banner over the lesson the
  // student was in the middle of reading. The engine is right to flag the
  // concept; it is not enough to lead with.
  stubSources(t, {
    path: [pathEntry({ status: "CURRENT" })],
    recommendations: [
      recommendation({
        priority: "HIGH",
        reason: "A recent question on this topic didn't go as expected.",
        evidence: { questionsAsked: 1, incorrect: 1, skipped: 0, hintsUsed: 0 }
      })
    ]
  });

  const { primary, secondary } = await run();

  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_LEARNING, "carrying on leads instead");
  // Still offered — suppressed from the headline, not thrown away.
  assert.ok(
    secondary.some((s) => s.title === "Review Java Inheritance"),
    "the recommendation survives as a secondary offer"
  );
});

test("two or more missed questions is enough to lead", async (t) => {
  stubSources(t, {
    path: [pathEntry({ status: "CURRENT" })],
    recommendations: [
      recommendation({
        priority: "HIGH",
        evidence: { questionsAsked: 4, incorrect: 2, skipped: 0, hintsUsed: 0 }
      })
    ]
  });

  assert.strictEqual((await run()).primary.action, NEXT_ACTION.REVIEW_TOPIC);
});

test("skips count toward the bar alongside wrong answers", async (t) => {
  stubSources(t, {
    path: [pathEntry({ status: "CURRENT" })],
    recommendations: [
      recommendation({
        priority: "HIGH",
        evidence: { questionsAsked: 3, incorrect: 1, skipped: 1, hintsUsed: 0 }
      })
    ]
  });

  assert.strictEqual((await run()).primary.action, NEXT_ACTION.REVIEW_TOPIC, "1 wrong + 1 skipped = 2 missed");
});

test("a signal with no question-level evidence can still lead", async (t) => {
  // Mastery decay or a recorded misconception — that came from somewhere
  // other than a single answer, so it is not subject to the same bar.
  stubSources(t, {
    path: [pathEntry({ status: "CURRENT" })],
    recommendations: [recommendation({ priority: "HIGH", evidence: null })]
  });

  assert.strictEqual((await run()).primary.action, NEXT_ACTION.REVIEW_TOPIC);
});

test("a low-priority signal does not displace continuing", async (t) => {
  stubSources(t, {
    path: [pathEntry({ status: "CURRENT" })],
    recommendations: [recommendation({ priority: "LOW" })]
  });

  const { primary, secondary } = await run();

  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_LEARNING);
  assert.strictEqual(secondary[0].action, NEXT_ACTION.PRACTICE_TOPIC, "offered alongside, not instead");
});

test("the priority comes from the decision engine, not from this module", async (t) => {
  // Same recommendation, only the engine's priority differs — and that alone
  // changes whether it leads.
  for (const [priority, expected] of [
    ["HIGH", NEXT_ACTION.REVIEW_TOPIC],
    ["MEDIUM", NEXT_ACTION.CONTINUE_LEARNING],
    ["LOW", NEXT_ACTION.CONTINUE_LEARNING]
  ]) {
    const originals = {
      learningPath: progressService.getStudentLearningPath,
      recs: recommendationService.getRecommendations
    };
    progressService.getStudentLearningPath = async () => [pathEntry({ status: "CURRENT" })];
    recommendationService.getRecommendations = async () => ({
      recommendations: [recommendation({ priority })],
      weakAreas: [],
      masteryOverview: []
    });

    assert.strictEqual((await run()).primary.action, expected, `priority ${priority}`);

    progressService.getStudentLearningPath = originals.learningPath;
    recommendationService.getRecommendations = originals.recs;
  }
});

// ---------------------------------------------------------------------------
// Qualifying tests
// ---------------------------------------------------------------------------

const withQualifyingQuiz = (overrides = {}) =>
  pathEntry({
    status: "CURRENT",
    skippable: true,
    qualifyingQuiz: {
      id: "qq-1",
      title: "Qualifying Test",
      passingScore: 70,
      attempts: 3,
      questionCount: 4
    },
    ...overrides
  });

test("an untried qualifying test is offered as the headline", async (t) => {
  stubSources(t, { path: [withQualifyingQuiz()], attempts: [] });

  const { primary, secondary } = await run();

  assert.strictEqual(primary.action, NEXT_ACTION.TAKE_QUALIFYING_TEST);
  assert.match(primary.reason, /4 questions, 70% to pass/);
  assert.strictEqual(primary.target.quizId, "qq-1");
  // Working through it normally stays available.
  assert.strictEqual(secondary[0].action, NEXT_ACTION.CONTINUE_LEARNING);
});

test("after failing, the lesson becomes the headline and the retry drops to secondary", async (t) => {
  stubSources(t, {
    path: [withQualifyingQuiz()],
    attempts: [{ attemptNumber: 1, passed: false, percentage: 40 }]
  });

  const { primary, secondary } = await run();

  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_LEARNING, "study, don't just re-sit");
  assert.match(primary.reason, /review the lesson before trying the qualifying test again/i);
  assert.strictEqual(secondary[0].action, NEXT_ACTION.RETRY_QUALIFYING_TEST);
});

test("with attempts exhausted, no retry is offered at all", async (t) => {
  stubSources(t, {
    path: [withQualifyingQuiz()],
    attempts: [
      { attemptNumber: 1, passed: false, percentage: 30 },
      { attemptNumber: 2, passed: false, percentage: 40 },
      { attemptNumber: 3, passed: false, percentage: 50 }
    ]
  });

  const { primary, secondary } = await run();

  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_LEARNING);
  assert.match(primary.reason, /used all qualifying attempts/i);
  assert.ok(
    !secondary.some((s) => s.action === NEXT_ACTION.RETRY_QUALIFYING_TEST),
    "retake eligibility is the server's answer and it says no"
  );
});

test("resolveQualifyingState mirrors the server's retake rule", async (t) => {
  const original = prisma.quizAttempt.findMany;
  t.after(() => {
    prisma.quizAttempt.findMany = original;
  });

  const entry = withQualifyingQuiz();

  prisma.quizAttempt.findMany = async () => [{ attemptNumber: 1, passed: false, percentage: 40 }];
  let state = await nextAction.resolveQualifyingState("student-1", entry);
  assert.strictEqual(state.canRetake, true);
  assert.strictEqual(state.attemptsUsed, 1);

  // Passing ends it, even with attempts left.
  prisma.quizAttempt.findMany = async () => [{ attemptNumber: 1, passed: true, percentage: 90 }];
  state = await nextAction.resolveQualifyingState("student-1", entry);
  assert.strictEqual(state.passed, true);
  assert.strictEqual(state.canRetake, false, "nothing left to qualify for");

  // Unlimited attempts (0) never runs out.
  prisma.quizAttempt.findMany = async () => [{ attemptNumber: 1, passed: false, percentage: 10 }];
  state = await nextAction.resolveQualifyingState("student-1", {
    ...entry,
    qualifyingQuiz: { ...entry.qualifyingQuiz, attempts: 0 }
  });
  assert.strictEqual(state.maxAttempts, null);
  assert.strictEqual(state.canRetake, true);
});

test("a node with no qualifying test has no qualifying state", async (t) => {
  assert.strictEqual(await nextAction.resolveQualifyingState("student-1", pathEntry()), null);
});

test("after qualifying out of a lesson, the next one is framed as qualified", async (t) => {
  stubSources(t, {
    path: [
      pathEntry({ id: "l1", qualified: true, satisfied: true, status: "QUALIFIED" }),
      pathEntry({ id: "l2", title: "Collections", status: "CURRENT" })
    ]
  });

  const { primary } = await run();

  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_TO_NEXT_LESSON);
  assert.strictEqual(primary.headline, "Qualified");
  assert.match(primary.reason, /demonstrated sufficient understanding/i);
  assert.strictEqual(primary.title, "Collections");
});

// ---------------------------------------------------------------------------
// Empty and degenerate states
// ---------------------------------------------------------------------------

test("a new student with no activity is simply told to continue", async (t) => {
  stubSources(t, { path: [pathEntry({ status: "CURRENT" })], recommendations: [] });

  const { primary, secondary } = await run();

  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_LEARNING);
  assert.match(primary.reason, /continue where you left off/i);
  assert.deepStrictEqual(secondary, [], "no invented extras");
});

test("a course with no content says so rather than inventing an action", async (t) => {
  stubSources(t, { path: [], recommendations: [] });

  const { primary } = await run();

  assert.strictEqual(primary.action, NEXT_ACTION.NOTHING_TO_DO);
  assert.strictEqual(primary.cta, null, "nothing to click");
});

test("every action carries a target the student can actually open", async (t) => {
  stubSources(t, {
    path: [withQualifyingQuiz()],
    attempts: [],
    recommendations: [recommendation({ priority: "LOW" })]
  });

  const { primary, secondary } = await run();

  assert.strictEqual(primary.target.courseId, COURSE);
  for (const offer of secondary) {
    assert.strictEqual(offer.target.courseId, COURSE, "secondary offers are reachable too");
  }
});

test("no internal model values reach the student", async (t) => {
  stubSources(t, {
    path: [pathEntry({ status: "CURRENT" })],
    recommendations: [recommendation({ priority: "HIGH" })]
  });

  const json = JSON.stringify(await run());

  assert.ok(!json.includes("masteryScore"));
  assert.ok(!json.includes("confidenceLevel"));
  assert.ok(!json.includes("question:"), "no synthetic knowledge-component ids");
});

// ---------------------------------------------------------------------------
// §16 — the result page's next step, i.e. the next action in the context of a
// quiz the student has just submitted.
//
// The invariant: the quiz context can only RE-RANK what the priority table
// already returned. It never invents an action, never grants an attempt the
// server would refuse, and never touches a qualifying test — those stay with
// the qualification rules that already own them.
// ---------------------------------------------------------------------------

const QUIZ = {
  id: "quiz-1",
  title: "Inheritance Check",
  courseId: COURSE,
  quizTag: "FINAL",
  attempts: 3,
  lessonId: "l1",
  topicId: "t1",
  moduleId: "m1"
};

/**
 * Stubs the aggregated sources AND the submitted quiz, keeping the two
 * quizAttempt.findMany callers apart by quizId so a qualifying test's attempt
 * log can differ from the submitted quiz's.
 */
function stubResultPage(t, { path = [], recommendations = [], quiz = QUIZ, quizAttempts = [], qualifyingAttempts = [] }) {
  const originals = {
    learningPath: progressService.getStudentLearningPath,
    recs: recommendationService.getRecommendations,
    attemptFindMany: prisma.quizAttempt.findMany,
    quizFindUnique: prisma.quiz.findUnique
  };

  t.after(() => {
    progressService.getStudentLearningPath = originals.learningPath;
    recommendationService.getRecommendations = originals.recs;
    prisma.quizAttempt.findMany = originals.attemptFindMany;
    prisma.quiz.findUnique = originals.quizFindUnique;
  });

  progressService.getStudentLearningPath = async () => path;
  recommendationService.getRecommendations = async () => ({
    recommendations,
    weakAreas: [],
    masteryOverview: []
  });
  prisma.quiz.findUnique = async () => quiz;
  prisma.quizAttempt.findMany = async ({ where }) =>
    where.quizId === quiz?.id ? quizAttempts : qualifyingAttempts;
}

const runForQuiz = (quizId = QUIZ.id) =>
  nextAction.getNextAction(STUDENT, { courseId: COURSE, quizId });

test("a failed quiz with attempts left leads with Retry Quiz", async (t) => {
  stubResultPage(t, {
    path: [pathEntry({ status: "CURRENT" })],
    quizAttempts: [{ attemptNumber: 1, passed: false }]
  });

  const { primary, secondary } = await runForQuiz();

  assert.strictEqual(primary.action, NEXT_ACTION.RETRY_QUIZ);
  assert.strictEqual(primary.cta, "Retry Quiz");
  assert.strictEqual(primary.target.quizId, QUIZ.id);
  assert.match(primary.reason, /1 of 3 attempts used/);
  // The table's own answer is demoted, not discarded.
  assert.strictEqual(secondary[0].action, NEXT_ACTION.CONTINUE_LEARNING);
});

test("a failed quiz with no attempts left never offers a retry", async (t) => {
  stubResultPage(t, {
    path: [pathEntry({ status: "CURRENT" })],
    quizAttempts: [
      { attemptNumber: 1, passed: false },
      { attemptNumber: 2, passed: false },
      { attemptNumber: 3, passed: false }
    ]
  });

  const { primary, secondary } = await runForQuiz();

  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_LEARNING);
  const actions = [primary, ...secondary].map((offer) => offer.action);
  assert.ok(!actions.includes(NEXT_ACTION.RETRY_QUIZ), "the allowance is spent");
});

test("a passed quiz moves the student on rather than back", async (t) => {
  stubResultPage(t, {
    path: [pathEntry({ status: "CURRENT" })],
    quizAttempts: [{ attemptNumber: 1, passed: true }]
  });

  const { primary, secondary } = await runForQuiz();

  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_LEARNING);
  const actions = [primary, ...secondary].map((offer) => offer.action);
  assert.ok(!actions.includes(NEXT_ACTION.RETRY_QUIZ), "nothing to retry");
});

test("an unlimited-attempt quiz says so instead of naming a limit", async (t) => {
  stubResultPage(t, {
    path: [pathEntry({ status: "CURRENT" })],
    quiz: { ...QUIZ, attempts: 0 },
    quizAttempts: [{ attemptNumber: 1, passed: false }]
  });

  const { primary } = await runForQuiz();

  assert.strictEqual(primary.action, NEXT_ACTION.RETRY_QUIZ);
  assert.ok(!/attempts used/.test(primary.reason), "no allowance to report");
});

test("review beats retry when the engine flagged a misconception", async (t) => {
  stubResultPage(t, {
    path: [pathEntry({ status: "CURRENT" })],
    recommendations: [recommendation({ priority: "HIGH" })],
    quizAttempts: [{ attemptNumber: 1, passed: false }]
  });

  const { primary, secondary } = await runForQuiz();

  assert.strictEqual(primary.action, NEXT_ACTION.REVIEW_TOPIC, "review before retrying");
  assert.ok(
    secondary.some((offer) => offer.action === NEXT_ACTION.RETRY_QUIZ),
    "the retry is still offered, it just doesn't lead"
  );
});

test("a failed QUALIFYING test is left to the qualification rules", async (t) => {
  stubResultPage(t, {
    path: [withQualifyingQuiz()],
    quiz: { ...QUIZ, id: "qq-1", quizTag: "QUALIFYING" },
    quizAttempts: [{ attemptNumber: 1, passed: false }],
    qualifyingAttempts: [{ attemptNumber: 1, passed: false, percentage: 40 }]
  });

  const { primary, secondary } = await runForQuiz("qq-1");

  // Rule 3 of the table, untouched: the lesson leads, the retry is secondary,
  // and it is RETRY_QUALIFYING_TEST — not the generic quiz retry.
  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_LEARNING);
  assert.strictEqual(secondary[0].action, NEXT_ACTION.RETRY_QUALIFYING_TEST);
  const actions = [primary, ...secondary].map((offer) => offer.action);
  assert.ok(!actions.includes(NEXT_ACTION.RETRY_QUIZ), "no competing retry rule");
  assert.strictEqual(
    secondary.filter((offer) => offer.action === NEXT_ACTION.RETRY_QUALIFYING_TEST).length,
    1,
    "offered once, not twice"
  );
});

test("a failed qualifying test still offers its retry when it hangs off the lesson, not the current topic", async (t) => {
  // The real shape: the student is on a TOPIC, and the qualifying test that
  // would let them skip belongs to the LESSON above it — so rule 3 never sees
  // it and the result page would otherwise never mention the retake.
  stubResultPage(t, {
    path: [pathEntry({ status: "CURRENT", title: "Polymorphism" })],
    quiz: { ...QUIZ, id: "qq-1", quizTag: "QUALIFYING", title: "Qualifying Test" },
    quizAttempts: [{ attemptNumber: 1, passed: false }]
  });

  const { primary, secondary } = await runForQuiz("qq-1");

  // The lesson still leads — the retry is appended, never promoted.
  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_LEARNING);
  const retry = secondary.find((offer) => offer.action === NEXT_ACTION.RETRY_QUALIFYING_TEST);
  assert.ok(retry, "the retake the student still has is surfaced");
  assert.strictEqual(retry.target.quizId, "qq-1");
  assert.match(retry.reason, /1 of 3 attempts used/);
});

test("a passed qualifying test is never offered again", async (t) => {
  stubResultPage(t, {
    path: [pathEntry({ status: "CURRENT" })],
    quiz: { ...QUIZ, id: "qq-1", quizTag: "QUALIFYING" },
    quizAttempts: [{ attemptNumber: 1, passed: true }]
  });

  const { primary, secondary } = await runForQuiz("qq-1");
  const actions = [primary, ...secondary].map((offer) => offer.action);

  assert.ok(!actions.includes(NEXT_ACTION.RETRY_QUALIFYING_TEST), "already qualified");
});

test("a spent qualifying allowance is not offered a retake", async (t) => {
  stubResultPage(t, {
    path: [pathEntry({ status: "CURRENT" })],
    quiz: { ...QUIZ, id: "qq-1", quizTag: "QUALIFYING", attempts: 2 },
    quizAttempts: [
      { attemptNumber: 1, passed: false },
      { attemptNumber: 2, passed: false }
    ]
  });

  const { primary, secondary } = await runForQuiz("qq-1");
  const actions = [primary, ...secondary].map((offer) => offer.action);

  assert.ok(!actions.includes(NEXT_ACTION.RETRY_QUALIFYING_TEST), "the allowance is spent");
});

test("a quiz from another course is ignored, not acted on", async (t) => {
  stubResultPage(t, {
    path: [pathEntry({ status: "CURRENT" })],
    quiz: { ...QUIZ, courseId: "course-2" },
    quizAttempts: [{ attemptNumber: 1, passed: false }]
  });

  const { primary } = await runForQuiz();

  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_LEARNING, "context discarded");
});

test("a quiz the student has never attempted changes nothing", async (t) => {
  stubResultPage(t, {
    path: [pathEntry({ status: "CURRENT" })],
    quizAttempts: []
  });

  const { primary } = await runForQuiz();

  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_LEARNING);
});

test("omitting quizId leaves the priority table exactly as it was", async (t) => {
  stubResultPage(t, {
    path: [pathEntry({ status: "CURRENT" })],
    quizAttempts: [{ attemptNumber: 1, passed: false }]
  });

  const withContext = await runForQuiz();
  const withoutContext = await nextAction.getNextAction(STUDENT, { courseId: COURSE });

  assert.strictEqual(withContext.primary.action, NEXT_ACTION.RETRY_QUIZ);
  assert.strictEqual(withoutContext.primary.action, NEXT_ACTION.CONTINUE_LEARNING);
});

test("the result-page next step exposes no internal model values", async (t) => {
  stubResultPage(t, {
    path: [pathEntry({ status: "CURRENT" })],
    recommendations: [recommendation({ priority: "HIGH" })],
    quizAttempts: [{ attemptNumber: 1, passed: false }]
  });

  const json = JSON.stringify(await runForQuiz());

  assert.ok(!json.includes("masteryScore"));
  assert.ok(!json.includes("confidenceLevel"));
  assert.ok(!json.includes("correctAnswer"), "no answer key on the way out");
  assert.ok(!json.includes("question:"));
});

test("a Self-Test's allowance is the rule submit enforces, not the stored column", async (t) => {
  // Quiz.attempts holds the schema default of 1 on rows saved before Self-Tests
  // became unlimited. Reading it directly told the student "1 of 1 attempts
  // used" underneath a Retry button that works — effectiveMaxAttempts is the
  // single rule, and this reads through it.
  stubResultPage(t, {
    path: [pathEntry({ status: "CURRENT" })],
    quiz: { ...QUIZ, quizTag: "SELF_TEST", attempts: 1 },
    quizAttempts: [{ attemptNumber: 1, passed: false }]
  });

  const { primary } = await runForQuiz();

  assert.strictEqual(primary.action, NEXT_ACTION.RETRY_QUIZ, "a Self-Test can always be retaken");
  assert.ok(!/attempts used/.test(primary.reason), "and no limit is claimed");
});

test("a FINAL quiz still reports its stored limit", async (t) => {
  stubResultPage(t, {
    path: [pathEntry({ status: "CURRENT" })],
    quiz: { ...QUIZ, quizTag: "FINAL", attempts: 2 },
    quizAttempts: [{ attemptNumber: 1, passed: false }]
  });

  const { primary } = await runForQuiz();

  assert.strictEqual(primary.action, NEXT_ACTION.RETRY_QUIZ);
  assert.match(primary.reason, /1 of 2 attempts used/);
});

test("a FINAL quiz at its stored limit is not offered a retry", async (t) => {
  stubResultPage(t, {
    path: [pathEntry({ status: "CURRENT" })],
    quiz: { ...QUIZ, quizTag: "FINAL", attempts: 1 },
    quizAttempts: [{ attemptNumber: 1, passed: false }]
  });

  const { primary, secondary } = await runForQuiz();
  const actions = [primary, ...secondary].map((offer) => offer.action);

  assert.ok(!actions.includes(NEXT_ACTION.RETRY_QUIZ), "one attempt, and it is spent");
});

// ---------------------------------------------------------------------------
// Phase 8 regression: long-term signals inform, they do not take over.
// ---------------------------------------------------------------------------

test("a MEDIUM retention recommendation never becomes the primary action", async (t) => {
  // Phase 8 candidates are fixed at MEDIUM precisely so this holds. If that
  // ever changes, a student mid-lesson starts being told to go and revise
  // something else instead, which is the regression this pins.
  stubSources(t, {
    path: [pathEntry({ status: "CURRENT" })],
    recommendations: [
      recommendation({
        id: "retention:Recursion",
        priority: "MEDIUM",
        title: "Review Recursion",
        reason: "You had this earlier, but recent questions on it didn't go as well."
      })
    ]
  });

  const { primary, secondary } = await run();

  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_LEARNING, "the path still leads");
  assert.ok(
    secondary.some((offer) => offer.title === "Review Recursion"),
    "but the signal is still offered"
  );
});

test("a HIGH mastery signal still outranks anything Phase 8 contributes", async (t) => {
  stubSources(t, {
    path: [pathEntry({ status: "CURRENT" })],
    recommendations: [
      recommendation({ priority: "HIGH", title: "Review Java Inheritance" }),
      recommendation({ id: "retention:Recursion", priority: "MEDIUM", title: "Review Recursion" })
    ]
  });

  const { primary } = await run();

  assert.strictEqual(primary.title, "Review Java Inheritance", "priority order is unchanged");
});
