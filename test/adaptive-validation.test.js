const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const recommendationService = require("../src/modules/learner-model/recommendation.service");
const nextActionService = require("../src/modules/learner-model/nextAction.service");
const retentionService = require("../src/modules/learner-model/retention.service");
const progressService = require("../src/modules/progress/progress.service");
const insightsService = require("../src/modules/learner-model/instructorInsights.service");
const { buildLearningPath, PATH_STATUS } = require("../src/utils/learningPath");
const { effectiveMaxAttempts, buildAttemptAllowance } = require("../src/utils/attemptAllowance");
const { classifierOutputSchema } = require("../src/modules/learner-model/misconceptionClassifier.validation");
const { MISCONCEPTION_TAXONOMY } = require("../src/modules/learner-model/misconceptionTaxonomy.config");

const { NEXT_ACTION } = nextActionService;

/**
 * PHASE 10 — validation of the complete adaptive pipeline.
 *
 * These are INTEGRATION tests, not unit tests. Everything below runs the real
 * decision engine, the real retention evaluators, the real recommendation
 * prioritisation and the real next-action priority table wired together; only
 * the database layer is stubbed. A unit test can pass while the pipeline
 * disagrees with itself, and the disagreements are what this phase is for.
 *
 * The file is organised as the Adaptive Decision Matrix: one section per
 * scenario, then one per conflict, then determinism, LLM boundaries,
 * sequential integrity and security.
 *
 * Expected priority, stated once and asserted throughout:
 *
 *   1. Qualification rules are authoritative. Nothing overrides what the
 *      qualifying-test rules say about a skip, a retry or an allowance.
 *   2. The learning path is authoritative about ACCESS. No recommendation
 *      can make locked content actionable.
 *   3. The deterministic engine chooses the primary action; only a HIGH
 *      signal is ever promoted to it.
 *   4. Phase 8 signals inform at MEDIUM and can never displace 1–3.
 *   5. Nothing is claimed without evidence for it.
 */

const STUDENT = { id: "student-1", userId: "user-1" };
const COURSE = "course-1";
const NOW = new Date("2026-03-01T12:00:00.000Z");
const daysBefore = (n) => new Date(NOW.getTime() - n * 86_400_000);
// Relative to the REAL clock, for fixtures that flow through services which
// take their own `new Date()` — see the note on getLearningSignals below.
const recentlyBefore = (n) => new Date(Date.now() - n * 86_400_000);

// ---------------------------------------------------------------------------
// Harness — stubs the DB, runs the real services
// ---------------------------------------------------------------------------

const mastery = (concept, status, overrides = {}) => ({
  concept,
  status,
  masteryScore: status === "MASTERED" ? 0.92 : status === "WEAK" ? 0.2 : 0.55,
  confidenceLevel: 0.8,
  attemptsCount: 5,
  recentScores: [],
  trend: "STABLE",
  lastCourseId: COURSE,
  updatedAt: NOW,
  ...overrides
});

const attemptRow = (concept, { isCorrect = true, answered = true, skipped = false, hintViewed = false } = {}) => ({
  isCorrect,
  answered,
  skipped,
  hintViewed,
  question: { topic: concept }
});

const topicRow = (id, title, lessonId = "lesson-1") => ({
  id,
  title,
  lessonId,
  lesson: { id: lessonId, title: "Java Basics", moduleId: "module-1" }
});

/** A (student, concept) signal row exactly as fetchSignalRows returns it. */
const signalRow = (concept, overrides = {}) => ({
  studentId: STUDENT.id,
  concept,
  answered: 4,
  correct: 3,
  distinctSeen: 3,
  distinctCorrectQuestions: 2,
  distinctCorrectQuizzes: 2,
  lastSeenAt: recentlyBefore(1),
  firstCorrectAt: recentlyBefore(20),
  delayedAnswered: 3,
  delayedCorrect: 3,
  ...overrides
});

const pathEntry = (overrides = {}) => ({
  kind: "TOPIC",
  id: "t1",
  title: "Inheritance",
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

const qualifyingQuiz = (overrides = {}) => ({
  id: "qq-1",
  title: "Qualifying Test",
  passingScore: 70,
  attempts: 3,
  questionCount: 4,
  ...overrides
});

/**
 * Stubs every database read the pipeline makes, and nothing else.
 *
 * Deliberately does NOT stub decision.service, recommendation prioritisation,
 * the retention evaluators or the next-action table — those are the things
 * under test.
 */
function stubPipeline(
  t,
  {
    masteries = [],
    gaps = [],
    attempts = [],
    topics = [],
    settledTopicIds = null,
    signals = [],
    path = [],
    quizAttempts = [],
    quiz = null
  }
) {
  const originals = {
    conceptFindMany: prisma.conceptMastery.findMany,
    gapFindMany: prisma.knowledgeGap.findMany,
    questionAttemptFindMany: prisma.questionAttempt.findMany,
    topicFindMany: prisma.topic.findMany,
    topicProgressFindMany: prisma.topicProgress.findMany,
    quizAttemptFindMany: prisma.quizAttempt.findMany,
    quizFindUnique: prisma.quiz.findUnique,
    fetchSignalRows: retentionService.fetchSignalRows,
    learningPath: progressService.getStudentLearningPath
  };

  t.after(() => {
    prisma.conceptMastery.findMany = originals.conceptFindMany;
    prisma.knowledgeGap.findMany = originals.gapFindMany;
    prisma.questionAttempt.findMany = originals.questionAttemptFindMany;
    prisma.topic.findMany = originals.topicFindMany;
    prisma.topicProgress.findMany = originals.topicProgressFindMany;
    prisma.quizAttempt.findMany = originals.quizAttemptFindMany;
    prisma.quiz.findUnique = originals.quizFindUnique;
    retentionService.fetchSignalRows = originals.fetchSignalRows;
    progressService.getStudentLearningPath = originals.learningPath;
  });

  const settled = settledTopicIds ?? topics.map((topic) => topic.id);

  prisma.conceptMastery.findMany = async () => masteries;
  prisma.knowledgeGap.findMany = async () => gaps;
  prisma.questionAttempt.findMany = async () => attempts;
  prisma.topic.findMany = async () => topics;
  prisma.topicProgress.findMany = async () => settled.map((topicId) => ({ topicId }));
  prisma.quizAttempt.findMany = async () => quizAttempts;
  prisma.quiz.findUnique = async () => quiz;
  retentionService.fetchSignalRows = async () => signals;
  progressService.getStudentLearningPath = async () => path;
}

const recommend = () => recommendationService.getRecommendations(STUDENT, { courseId: COURSE, limit: 5 });
const decide = (opts = {}) => nextActionService.getNextAction(STUDENT, { courseId: COURSE, ...opts });

// ===========================================================================
// SCENARIO A — strong mastery + delayed decay
// ===========================================================================

test("A: mastered-but-decayed produces a review, and never claims mastery", async (t) => {
  stubPipeline(t, {
    masteries: [mastery("Recursion", "MASTERED")],
    topics: [topicRow("t7", "Recursion")],
    attempts: [attemptRow("Recursion", { isCorrect: true })],
    signals: [signalRow("Recursion", { delayedAnswered: 3, delayedCorrect: 0 })],
    path: [pathEntry({ status: "CURRENT", title: "Generics" })]
  });

  const { recommendations } = await recommend();
  const { primary, secondary } = await decide();

  // Recommendation: review is offered even though mastery reads MASTERED.
  assert.strictEqual(recommendations.length, 1);
  assert.strictEqual(recommendations[0].id, "retention:Recursion");
  assert.strictEqual(recommendations[0].type, "REVIEW_CONCEPT");

  // Next action: the path still leads — Phase 8 informs, it does not displace.
  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_LEARNING);
  assert.strictEqual(primary.title, "Generics");
  assert.ok(secondary.some((o) => o.title === "Review Recursion"));

  // Nothing anywhere tells the student they have mastered it.
  const text = JSON.stringify({ recommendations, primary, secondary });
  assert.ok(!/mastered/i.test(text), "no mastery claim survives a decayed signal");
});

test("A: sequential learning is not bypassed by a review recommendation", async (t) => {
  stubPipeline(t, {
    masteries: [mastery("Recursion", "MASTERED")],
    topics: [topicRow("t7", "Recursion")],
    attempts: [attemptRow("Recursion", { isCorrect: true })],
    signals: [signalRow("Recursion", { delayedAnswered: 3, delayedCorrect: 0 })],
    path: [pathEntry({ status: "CURRENT", title: "Generics", topicId: "t-generics" })]
  });

  const { primary } = await decide();

  assert.strictEqual(primary.target.topicId, "t-generics", "the path's node, not the review target");
});

// ===========================================================================
// SCENARIO B — strong mastery + insufficient transfer
// ===========================================================================

test("B: repeated success on familiar questions is never called transfer", async (t) => {
  stubPipeline(t, {
    masteries: [mastery("Loops", "MASTERED")],
    topics: [topicRow("t9", "Loops")],
    attempts: [attemptRow("Loops", { isCorrect: true })],
    signals: [
      signalRow("Loops", {
        delayedAnswered: 3,
        delayedCorrect: 3,
        distinctSeen: 2,
        distinctCorrectQuestions: 1,
        distinctCorrectQuizzes: 2
      })
    ],
    path: [pathEntry({ status: "CURRENT" })]
  });

  const { signals } = await retentionService.getLearningSignals(STUDENT, { courseId: COURSE, now: NOW });
  const { recommendations } = await recommend();

  assert.strictEqual(signals[0].transfer.status, "REPEATED_ONLY");
  assert.strictEqual(recommendations[0].id, "transfer:Loops");
  assert.match(recommendations[0].title, /Practise applying/i);
});

test("B: no unsupported conclusion reaches the learner", async (t) => {
  stubPipeline(t, {
    masteries: [mastery("Loops", "MASTERED")],
    topics: [topicRow("t9", "Loops")],
    attempts: [attemptRow("Loops", { isCorrect: true })],
    signals: [
      signalRow("Loops", {
        delayedAnswered: 0,
        delayedCorrect: 0,
        distinctSeen: 1,
        distinctCorrectQuestions: 1,
        distinctCorrectQuizzes: 1
      })
    ],
    path: [pathEntry({ status: "CURRENT" })]
  });

  const { signals } = await retentionService.getLearningSignals(STUDENT, { courseId: COURSE, now: NOW });

  assert.strictEqual(signals[0].retention.status, "INSUFFICIENT_EVIDENCE");
  assert.strictEqual(signals[0].transfer.status, "INSUFFICIENT_EVIDENCE");
  assert.strictEqual(signals[0].retention.retentionRate, null);
  // One question seen: nothing is asserted about transfer either way.
  assert.deepStrictEqual((await recommend()).recommendations, []);
});

// ===========================================================================
// SCENARIO C — repeated failure + misconception
// ===========================================================================

test("C: a misconception and repeated failure produce ONE coherent card", async (t) => {
  stubPipeline(t, {
    masteries: [mastery("Inheritance", "WEAK")],
    gaps: [{ concept: "Inheritance", kc: "Inheritance", status: "OPEN", severity: 0.8, type: "TERMINOLOGY_CONFUSION" }],
    topics: [topicRow("t1", "Inheritance")],
    attempts: [
      attemptRow("Inheritance", { isCorrect: false }),
      attemptRow("Inheritance", { isCorrect: false }),
      attemptRow("Inheritance", { isCorrect: false })
    ],
    signals: [signalRow("Inheritance", { answered: 3, correct: 0, delayedAnswered: 3, delayedCorrect: 0 })],
    path: [pathEntry({ status: "CURRENT", title: "Inheritance" })]
  });

  const { recommendations } = await recommend();

  assert.strictEqual(recommendations.length, 1, "not one card per signal — one per concept");
  assert.strictEqual(recommendations[0].id, "concept:Inheritance", "the engine's, not Phase 8's");
  assert.strictEqual(recommendations[0].priority, "HIGH");
});

test("C: the misconception drives the primary action deterministically", async (t) => {
  stubPipeline(t, {
    masteries: [mastery("Inheritance", "WEAK")],
    gaps: [{ concept: "Inheritance", kc: "Inheritance", status: "OPEN", severity: 0.8, type: "TERMINOLOGY_CONFUSION" }],
    topics: [topicRow("t1", "Inheritance")],
    attempts: [
      attemptRow("Inheritance", { isCorrect: false }),
      attemptRow("Inheritance", { isCorrect: false }),
      attemptRow("Inheritance", { isCorrect: false })
    ],
    signals: [],
    path: [pathEntry({ status: "CURRENT", title: "Inheritance" })]
  });

  const { primary } = await decide();

  assert.strictEqual(primary.action, NEXT_ACTION.REVIEW_TOPIC);
  assert.strictEqual(primary.headline, "Your next step");
});

// ===========================================================================
// SCENARIO D — qualifying test failed, attempts remaining
// ===========================================================================

test("D: a failed qualifying test points at the lesson, retry demoted", async (t) => {
  stubPipeline(t, {
    path: [pathEntry({ status: "CURRENT", skippable: true, qualifyingQuiz: qualifyingQuiz() })],
    quizAttempts: [{ attemptNumber: 1, passed: false, percentage: 40 }]
  });

  const { primary, secondary } = await decide();

  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_LEARNING);
  assert.strictEqual(secondary[0].action, NEXT_ACTION.RETRY_QUALIFYING_TEST);
});

test("D: a qualifying retry is never confused with an ordinary quiz retry", async (t) => {
  stubPipeline(t, {
    path: [pathEntry({ status: "CURRENT", skippable: true, qualifyingQuiz: qualifyingQuiz() })],
    quizAttempts: [{ attemptNumber: 1, passed: false, percentage: 40 }],
    quiz: { id: "qq-1", title: "Qualifying Test", courseId: COURSE, quizTag: "QUALIFYING", attempts: 3, lessonId: "l1", topicId: null, moduleId: "m1" }
  });

  const { primary, secondary } = await decide({ quizId: "qq-1" });
  const actions = [primary, ...secondary].map((o) => o.action);

  assert.ok(actions.includes(NEXT_ACTION.RETRY_QUALIFYING_TEST));
  assert.ok(!actions.includes(NEXT_ACTION.RETRY_QUIZ), "the generic retry never applies to a qualifying test");
});

test("D: content stays locked while the qualifying test is unpassed", async (t) => {
  const hierarchy = {
    modules: [
      {
        id: "m1", title: "Module 1", completed: false, satisfied: false,
        lessons: [
          { id: "l1", title: "Lesson 1", completed: false, satisfied: false, qualified: false, topics: [
            { id: "t1", title: "Topic 1", completed: false, satisfied: false, qualified: false }
          ] },
          { id: "l2", title: "Lesson 2", completed: false, satisfied: false, qualified: false, topics: [
            { id: "t2", title: "Topic 2", completed: false, satisfied: false, qualified: false }
          ] }
        ]
      }
    ]
  };

  const path = buildLearningPath(hierarchy, {
    byTopicId: new Map(),
    byLessonId: new Map([["l1", qualifyingQuiz()]])
  });

  const lesson2 = path.find((e) => e.id === "l2");
  assert.strictEqual(lesson2.status, PATH_STATUS.LOCKED, "failing to skip leaves what follows locked");
});

// ===========================================================================
// SCENARIO E — qualifying test passed
// ===========================================================================

test("E: passing a qualifying test unlocks what follows, without claiming completion", async (t) => {
  const hierarchy = {
    modules: [
      {
        id: "m1", title: "Module 1", completed: false, satisfied: false,
        lessons: [
          { id: "l1", title: "Lesson 1", completed: false, satisfied: true, qualified: true, topics: [
            { id: "t1", title: "Topic 1", completed: false, satisfied: false, qualified: false }
          ] },
          { id: "l2", title: "Lesson 2", completed: false, satisfied: false, qualified: false, topics: [
            { id: "t2", title: "Topic 2", completed: false, satisfied: false, qualified: false }
          ] }
        ]
      }
    ]
  };

  const path = buildLearningPath(hierarchy, { byTopicId: new Map(), byLessonId: new Map() });

  const lesson1 = path.find((e) => e.id === "l1");
  const lesson2 = path.find((e) => e.id === "l2");

  assert.strictEqual(lesson1.status, PATH_STATUS.QUALIFIED, "qualified is its own status, not COMPLETED");
  assert.strictEqual(lesson1.completed, false, "skipped is not studied");
  assert.notStrictEqual(lesson2.status, PATH_STATUS.LOCKED, "what follows is open");
});

test("E: a qualified learner is not offered the qualifying test again", async (t) => {
  stubPipeline(t, {
    path: [
      pathEntry({ id: "l1", kind: "LESSON", title: "Lesson 1", status: "QUALIFIED", qualified: true, satisfied: true }),
      pathEntry({ id: "t2", title: "Topic 2", status: "CURRENT" })
    ],
    quizAttempts: [{ attemptNumber: 1, passed: true, percentage: 90 }]
  });

  const { primary, secondary } = await decide();
  const actions = [primary, ...secondary].map((o) => o.action);

  assert.ok(!actions.includes(NEXT_ACTION.RETRY_QUALIFYING_TEST));
  assert.ok(!actions.includes(NEXT_ACTION.TAKE_QUALIFYING_TEST));
  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_TO_NEXT_LESSON, "framed as qualified, not completed");
});

test("E: skipped content is never presented as mandatory study", async (t) => {
  stubPipeline(t, {
    masteries: [mastery("Inheritance", "MASTERED")],
    topics: [topicRow("t1", "Inheritance")],
    attempts: [attemptRow("Inheritance", { isCorrect: true })],
    // Qualified counts as settled, so the topic IS recommendable for review —
    // but only as a suggestion, never as required work.
    settledTopicIds: ["t1"],
    signals: [],
    path: [
      pathEntry({ id: "l1", kind: "LESSON", status: "QUALIFIED", qualified: true, satisfied: true }),
      pathEntry({ id: "t2", title: "Topic 2", status: "CURRENT" })
    ]
  });

  const { primary } = await decide();

  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_TO_NEXT_LESSON);
  assert.strictEqual(primary.title, "Topic 2", "forward, not back into the skipped lesson");
});

// ===========================================================================
// SCENARIO F — attempt allowance, one rule everywhere
// ===========================================================================

test("F: effectiveMaxAttempts is the single rule, across every shape", async () => {
  // SELF_TEST is unlimited whatever the column says.
  assert.strictEqual(effectiveMaxAttempts({ quizTag: "SELF_TEST", attempts: 1 }), 0);
  assert.strictEqual(effectiveMaxAttempts({ quizTag: "SELF_TEST", attempts: 5 }), 0);
  // Everything else uses its stored limit.
  assert.strictEqual(effectiveMaxAttempts({ quizTag: "FINAL", attempts: 3 }), 3);
  assert.strictEqual(effectiveMaxAttempts({ quizTag: "QUALIFYING", attempts: 3 }), 3);
  // 0 means unlimited.
  assert.strictEqual(buildAttemptAllowance(0, 99).canAttempt, true);
  assert.strictEqual(buildAttemptAllowance(0, 99).unlimitedAttempts, true);
  assert.strictEqual(buildAttemptAllowance(0, 99).maxAttempts, null);
  // Final allowed attempt is still allowed; the one after is not.
  assert.strictEqual(buildAttemptAllowance(3, 2).canAttempt, true);
  assert.strictEqual(buildAttemptAllowance(3, 3).canAttempt, false);
  assert.strictEqual(buildAttemptAllowance(3, 3).attemptsRemaining, 0);
});

test("F: no adaptive caller reads Quiz.attempts directly", async () => {
  // A silent regression here would tell a student "1 of 1 attempts used"
  // beneath a working retry button. Asserted against the source so a new
  // caller cannot reintroduce it unnoticed.
  const fs = require("fs");
  const files = [
    "src/modules/learner-model/nextAction.service.js",
    "src/modules/learner-model/instructorInsights.service.js"
  ];

  for (const file of files) {
    const raw = fs.readFileSync(file, "utf8");
    // Comments discuss `quiz.attempts` precisely because reading it directly
    // is the mistake being guarded against — strip them before matching, or
    // the guard fires on its own explanation.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const direct = source.match(/quiz\.attempts|\.attempts\s*>\s*0/g) || [];
    assert.deepStrictEqual(
      direct,
      [],
      `${file} reads an attempt allowance without effectiveMaxAttempts`
    );
    assert.ok(source.includes("effectiveMaxAttempts"), `${file} should use the shared rule`);
  }
});

test("F: a spent allowance offers no retry anywhere in the pipeline", async (t) => {
  stubPipeline(t, {
    path: [pathEntry({ status: "CURRENT", skippable: true, qualifyingQuiz: qualifyingQuiz({ attempts: 2 }) })],
    quizAttempts: [
      { attemptNumber: 1, passed: false, percentage: 40 },
      { attemptNumber: 2, passed: false, percentage: 45 }
    ]
  });

  const { primary, secondary } = await decide();
  const actions = [primary, ...secondary].map((o) => o.action);

  assert.ok(!actions.includes(NEXT_ACTION.RETRY_QUALIFYING_TEST));
  assert.match(primary.reason, /used all qualifying attempts/i);
});

// ===========================================================================
// SCENARIO G — older attempt
// ===========================================================================

test("G: reading state never mutates it", async (t) => {
  // Every write delegate is replaced with a throw. If any read path in the
  // adaptive pipeline writes, this fails loudly rather than silently.
  const writes = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];
  const models = ["conceptMastery", "knowledgeGap", "quizAttempt", "questionAttempt", "topicProgress"];
  const originals = [];

  for (const model of models) {
    for (const op of writes) {
      if (typeof prisma[model]?.[op] !== "function") continue;
      originals.push([model, op, prisma[model][op]]);
      prisma[model][op] = async () => {
        throw new Error(`unexpected write: prisma.${model}.${op}`);
      };
    }
  }

  t.after(() => {
    for (const [model, op, fn] of originals) prisma[model][op] = fn;
  });

  stubPipeline(t, {
    masteries: [mastery("Recursion", "MASTERED")],
    topics: [topicRow("t7", "Recursion")],
    attempts: [attemptRow("Recursion", { isCorrect: true })],
    signals: [signalRow("Recursion", { delayedAnswered: 3, delayedCorrect: 0 })],
    path: [pathEntry({ status: "CURRENT" })],
    quizAttempts: [{ attemptNumber: 1, passed: false }]
  });

  await recommend();
  await decide();
  await retentionService.getLearningSignals(STUDENT, { courseId: COURSE, now: NOW });
});

test("G: an unattempted quiz context leaves the decision untouched", async (t) => {
  stubPipeline(t, {
    path: [pathEntry({ status: "CURRENT" })],
    quizAttempts: [],
    quiz: { id: "q-1", title: "Quiz", courseId: COURSE, quizTag: "FINAL", attempts: 3, lessonId: "l1", topicId: null, moduleId: "m1" }
  });

  const withContext = await decide({ quizId: "q-1" });
  const withoutContext = await decide();

  assert.deepStrictEqual(withContext, withoutContext);
});

// ===========================================================================
// CONFLICT MATRIX
// ===========================================================================

test("Conflict 1: misconception + decay + weak mastery resolves to the engine's HIGH card", async (t) => {
  stubPipeline(t, {
    masteries: [mastery("Inheritance", "WEAK")],
    gaps: [{ concept: "Inheritance", kc: "Inheritance", status: "OPEN", severity: 0.9, type: "TERMINOLOGY_CONFUSION" }],
    topics: [topicRow("t1", "Inheritance")],
    attempts: [
      attemptRow("Inheritance", { isCorrect: false }),
      attemptRow("Inheritance", { isCorrect: false }),
      attemptRow("Inheritance", { isCorrect: false })
    ],
    signals: [signalRow("Inheritance", { answered: 3, correct: 0, delayedAnswered: 3, delayedCorrect: 0 })],
    path: [pathEntry({ status: "CURRENT" })]
  });

  const { recommendations } = await recommend();

  assert.strictEqual(recommendations.length, 1);
  assert.strictEqual(recommendations[0].id, "concept:Inheritance");
  assert.strictEqual(recommendations[0].priority, "HIGH", "the misconception rule outranks the rest");
});

test("Conflict 2: strong mastery + decay + good transfer does not contradict itself", async (t) => {
  stubPipeline(t, {
    masteries: [mastery("Recursion", "MASTERED")],
    topics: [topicRow("t7", "Recursion")],
    attempts: [attemptRow("Recursion", { isCorrect: true })],
    signals: [
      signalRow("Recursion", {
        delayedAnswered: 3,
        delayedCorrect: 0,
        distinctCorrectQuestions: 2,
        distinctCorrectQuizzes: 2
      })
    ],
    path: [pathEntry({ status: "CURRENT" })]
  });

  const { recommendations } = await recommend();

  // Decay wins over transfer for the SAME concept: one card, and it is the
  // review. "You've applied this well" and "go back over this" must not both
  // be shown about one concept.
  assert.strictEqual(recommendations.length, 1);
  assert.strictEqual(recommendations[0].id, "retention:Recursion");
  assert.strictEqual(recommendations[0].type, "REVIEW_CONCEPT");
});

test("Conflict 3: qualification rules stay authoritative over a review card", async (t) => {
  stubPipeline(t, {
    masteries: [mastery("Inheritance", "WEAK")],
    topics: [topicRow("t1", "Inheritance")],
    attempts: [attemptRow("Inheritance", { isCorrect: false })],
    signals: [],
    path: [pathEntry({ status: "CURRENT", skippable: true, qualifyingQuiz: qualifyingQuiz() })],
    quizAttempts: [{ attemptNumber: 1, passed: false, percentage: 40 }]
  });

  const { primary, secondary } = await decide();

  // A single missed question does not promote a review past the qualification
  // rules (MIN_MISSED_TO_LEAD), so rule 3 owns the outcome.
  assert.strictEqual(primary.action, NEXT_ACTION.CONTINUE_LEARNING);
  assert.ok(secondary.some((o) => o.action === NEXT_ACTION.RETRY_QUALIFYING_TEST));
});

test("Conflict 4: a recommendation can never make locked content actionable", async (t) => {
  stubPipeline(t, {
    masteries: [mastery("Generics", "WEAK")],
    topics: [topicRow("t-locked", "Generics")],
    attempts: [
      attemptRow("Generics", { isCorrect: false }),
      attemptRow("Generics", { isCorrect: false })
    ],
    settledTopicIds: [],
    signals: [],
    path: [
      pathEntry({ status: "CURRENT", title: "Inheritance", topicId: "t1" }),
      pathEntry({ id: "t-locked", topicId: "t-locked", title: "Generics", status: "LOCKED", locked: true })
    ]
  });

  const { recommendations } = await recommend();
  const { primary } = await decide();

  assert.deepStrictEqual(recommendations, [], "unsettled/locked content is not recommendable");
  assert.strictEqual(primary.target.topicId, "t1", "the primary stays on the path's current node");
});

test("Conflict 5: the settled-content gate holds for Phase 8 candidates too", async (t) => {
  stubPipeline(t, {
    masteries: [mastery("Recursion", "MASTERED")],
    topics: [topicRow("t7", "Recursion")],
    attempts: [attemptRow("Recursion", { isCorrect: true })],
    settledTopicIds: [],
    signals: [signalRow("Recursion", { delayedAnswered: 3, delayedCorrect: 0 })],
    path: [pathEntry({ status: "CURRENT" })]
  });

  assert.deepStrictEqual((await recommend()).recommendations, []);
});

// ===========================================================================
// DETERMINISM
// ===========================================================================

test("determinism: identical state produces an identical decision", async (t) => {
  stubPipeline(t, {
    masteries: [mastery("Inheritance", "WEAK"), mastery("Recursion", "MASTERED"), mastery("Loops", "DEVELOPING")],
    gaps: [{ concept: "Inheritance", kc: "Inheritance", status: "OPEN", severity: 0.8, type: "TERMINOLOGY_CONFUSION" }],
    topics: [topicRow("t1", "Inheritance"), topicRow("t7", "Recursion"), topicRow("t9", "Loops")],
    attempts: [
      attemptRow("Inheritance", { isCorrect: false }),
      attemptRow("Inheritance", { isCorrect: false }),
      attemptRow("Loops", { isCorrect: false })
    ],
    signals: [
      signalRow("Recursion", { delayedAnswered: 3, delayedCorrect: 0 }),
      signalRow("Loops", { delayedAnswered: 3, delayedCorrect: 3, distinctCorrectQuizzes: 1 })
    ],
    path: [pathEntry({ status: "CURRENT" })]
  });

  const first = await decide();
  const second = await decide();
  const firstRecs = await recommend();
  const secondRecs = await recommend();

  assert.deepStrictEqual(first, second, "action, target, priority and reason all identical");
  assert.deepStrictEqual(firstRecs, secondRecs);
});

test("determinism: the outcome does not depend on database row order", async (t) => {
  const base = {
    masteries: [mastery("Inheritance", "WEAK"), mastery("Recursion", "MASTERED"), mastery("Loops", "DEVELOPING")],
    topics: [topicRow("t1", "Inheritance"), topicRow("t7", "Recursion"), topicRow("t9", "Loops")],
    attempts: [
      attemptRow("Inheritance", { isCorrect: false }),
      attemptRow("Inheritance", { isCorrect: false }),
      attemptRow("Loops", { isCorrect: false }),
      attemptRow("Loops", { isCorrect: false })
    ],
    signals: [
      signalRow("Recursion", { delayedAnswered: 3, delayedCorrect: 0 }),
      signalRow("Loops", { delayedAnswered: 3, delayedCorrect: 0 })
    ],
    path: [pathEntry({ status: "CURRENT" })]
  };

  // Stubbed ONCE. Calling stubPipeline twice in a single test nests the
  // stubs, and the restore order then leaks one into later tests — so the
  // reversal is applied by swapping what the existing stubs return.
  let current = base;
  stubPipeline(t, base);
  prisma.conceptMastery.findMany = async () => current.masteries;
  prisma.questionAttempt.findMany = async () => current.attempts;
  prisma.topic.findMany = async () => current.topics;
  retentionService.fetchSignalRows = async () => current.signals;

  const forward = await recommend();

  // Same facts, every list reversed — the sort must be total.
  current = {
    ...base,
    masteries: [...base.masteries].reverse(),
    topics: [...base.topics].reverse(),
    attempts: [...base.attempts].reverse(),
    signals: [...base.signals].reverse()
  };
  const reversed = await recommend();

  assert.deepStrictEqual(
    forward.recommendations.map((r) => r.id),
    reversed.recommendations.map((r) => r.id),
    "row order must not decide priority"
  );
});

test("determinism: retention depends on time only where the definition says so", async () => {
  const row = signalRow("Recursion", { delayedAnswered: 3, delayedCorrect: 0 });

  const a = retentionService.evaluateRetention(row, NOW);
  const b = retentionService.evaluateRetention(row, NOW);
  const later = retentionService.evaluateRetention(row, new Date(NOW.getTime() + 86_400_000));

  assert.deepStrictEqual(a, b, "same clock, same answer");
  assert.strictEqual(later.status, a.status, "the classification itself is time-independent");
  assert.strictEqual(later.daysSinceLastSeen, a.daysSinceLastSeen + 1, "only the elapsed-days figure moves");
});

test("determinism: transfer is a pure function of counts", async () => {
  const row = signalRow("Loops", { distinctCorrectQuestions: 1, distinctCorrectQuizzes: 2 });
  assert.deepStrictEqual(retentionService.evaluateTransfer(row), retentionService.evaluateTransfer(row));
});

// ===========================================================================
// LLM BOUNDARIES
// ===========================================================================

test("LLM: no decision service imports the LLM at all", async () => {
  // The strongest available statement of the boundary: the modules that make
  // learning decisions cannot call a model, because they do not have one.
  const fs = require("fs");
  const decisionModules = [
    "src/modules/learner-model/decision.service.js",
    "src/modules/learner-model/nextAction.service.js",
    "src/modules/learner-model/recommendation.service.js",
    "src/modules/learner-model/retention.service.js",
    "src/modules/learner-model/bkt.service.js",
    "src/modules/learner-model/instructorInsights.service.js",
    "src/utils/learningPath.js",
    "src/utils/attemptAllowance.js",
    "src/utils/qualification.js"
  ];

  for (const file of decisionModules) {
    const source = fs.readFileSync(file, "utf8");
    assert.ok(!/require\(["'].*llm/i.test(source), `${file} must not import an LLM client`);
    assert.ok(!/llmService|generateStream|ollama|gemini/i.test(source), `${file} must not reference a model`);
  }
});

test("LLM: a classification outside the taxonomy is rejected, however confident", async () => {
  const { error } = classifierOutputSchema.validate({
    detected: true,
    type: "STUDENT_IS_LAZY",
    description: "made up",
    confidence: 1.0
  });

  assert.ok(error, "an invented type fails validation like malformed JSON");
});

test("LLM: only the fixed taxonomy can ever reach a knowledge gap", async () => {
  for (const type of Object.keys(MISCONCEPTION_TAXONOMY)) {
    const { error } = classifierOutputSchema.validate({
      detected: true, type, description: "ok", confidence: 0.9
    });
    assert.ok(!error, `${type} should validate`);
  }
});

test("LLM: the pipeline produces a full decision with no model available", async (t) => {
  // If the model were required anywhere in the decision path, replacing it
  // with a throwing stub would surface here.
  const llmService = require("../src/modules/llm/llm.service");
  const originals = { generate: llmService.generate, generateStream: llmService.generateStream };
  t.after(() => {
    llmService.generate = originals.generate;
    llmService.generateStream = originals.generateStream;
  });
  llmService.generate = async () => {
    throw new Error("LLM unavailable");
  };
  llmService.generateStream = llmService.generate;

  stubPipeline(t, {
    masteries: [mastery("Inheritance", "WEAK")],
    gaps: [{ concept: "Inheritance", kc: "Inheritance", status: "OPEN", severity: 0.8, type: "TERMINOLOGY_CONFUSION" }],
    topics: [topicRow("t1", "Inheritance")],
    attempts: [attemptRow("Inheritance", { isCorrect: false }), attemptRow("Inheritance", { isCorrect: false })],
    signals: [signalRow("Recursion", { delayedAnswered: 3, delayedCorrect: 0 })],
    path: [pathEntry({ status: "CURRENT" })]
  });

  const { primary } = await decide();
  const { recommendations } = await recommend();

  assert.ok(primary.action, "a primary action is still chosen");
  assert.ok(Array.isArray(recommendations));
});

// ===========================================================================
// SEQUENTIAL-LEARNING INTEGRITY
// ===========================================================================

test("sequential: completion unlocks the next item, and only the next", async () => {
  const hierarchy = {
    modules: [
      {
        id: "m1", title: "M1", completed: false, satisfied: false,
        lessons: [
          { id: "l1", title: "L1", completed: true, satisfied: true, qualified: false, topics: [
            { id: "t1", title: "T1", completed: true, satisfied: true, qualified: false }
          ] },
          { id: "l2", title: "L2", completed: false, satisfied: false, qualified: false, topics: [
            { id: "t2", title: "T2", completed: false, satisfied: false, qualified: false },
            { id: "t3", title: "T3", completed: false, satisfied: false, qualified: false }
          ] }
        ]
      }
    ]
  };

  const path = buildLearningPath(hierarchy, { byTopicId: new Map(), byLessonId: new Map() });
  const byId = new Map(path.map((e) => [e.id, e]));

  assert.strictEqual(byId.get("t1").status, PATH_STATUS.COMPLETED);
  assert.strictEqual(byId.get("t2").status, PATH_STATUS.CURRENT, "the next item is current");
  assert.strictEqual(byId.get("t3").status, PATH_STATUS.LOCKED, "and the one after is not");
});

test("sequential: a container never locks its own children", async () => {
  const hierarchy = {
    modules: [
      {
        id: "m1", title: "M1", completed: false, satisfied: false,
        lessons: [
          { id: "l1", title: "L1", completed: false, satisfied: false, qualified: false, topics: [
            { id: "t1", title: "T1", completed: false, satisfied: false, qualified: false }
          ] }
        ]
      }
    ]
  };

  const path = buildLearningPath(hierarchy, { byTopicId: new Map(), byLessonId: new Map() });

  for (const entry of path) {
    assert.notStrictEqual(entry.status, PATH_STATUS.LOCKED, `${entry.id} must not be locked at course start`);
  }
});

test("sequential: qualified and completed are represented separately", async () => {
  const hierarchy = {
    modules: [
      {
        id: "m1", title: "M1", completed: false, satisfied: false,
        lessons: [
          { id: "l1", title: "L1", completed: false, satisfied: true, qualified: true, topics: [] },
          { id: "l2", title: "L2", completed: true, satisfied: true, qualified: false, topics: [] }
        ]
      }
    ]
  };

  const path = buildLearningPath(hierarchy, { byTopicId: new Map(), byLessonId: new Map() });
  const byId = new Map(path.map((e) => [e.id, e]));

  assert.strictEqual(byId.get("l1").status, PATH_STATUS.QUALIFIED);
  assert.strictEqual(byId.get("l1").completed, false);
  assert.strictEqual(byId.get("l2").status, PATH_STATUS.COMPLETED);
  assert.strictEqual(byId.get("l2").qualified, false);
});

test("sequential: the next action never contradicts the path", async (t) => {
  stubPipeline(t, {
    path: [
      pathEntry({ id: "t1", topicId: "t1", title: "Done", status: "COMPLETED", completed: true, satisfied: true }),
      pathEntry({ id: "t2", topicId: "t2", title: "Here", status: "CURRENT" }),
      pathEntry({ id: "t3", topicId: "t3", title: "Later", status: "LOCKED", locked: true })
    ]
  });

  const { primary, secondary } = await decide();
  const targets = [primary, ...secondary].map((o) => o.target.topicId).filter(Boolean);

  assert.ok(!targets.includes("t3"), "nothing points at locked content");
  assert.strictEqual(primary.target.topicId, "t2");
});

// ===========================================================================
// SECURITY BOUNDARIES
// ===========================================================================

test("security: a student cannot reach another student's adaptive state", async (t) => {
  const learnerModelService = require("../src/modules/learner-model/learnerModel.service");
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

test("security: an instructor cannot reach another instructor's course analytics", async (t) => {
  const original = prisma.course.findFirst;
  t.after(() => {
    prisma.course.findFirst = original;
  });
  prisma.course.findFirst = async ({ where }) =>
    where.creatorId && where.creatorId !== "owner" ? null : { id: COURSE, title: "Course" };

  await assert.rejects(
    () => insightsService.assertInstructorCourseAccess({ id: "stranger", role: "INSTRUCTOR" }, COURSE),
    (error) => error.statusCode === 404
  );

  const allowed = await insightsService.assertInstructorCourseAccess({ id: "owner", role: "INSTRUCTOR" }, COURSE);
  assert.strictEqual(allowed.id, COURSE);
});

test("security: not-yours and does-not-exist are indistinguishable", async (t) => {
  const original = prisma.course.findFirst;
  t.after(() => {
    prisma.course.findFirst = original;
  });
  prisma.course.findFirst = async () => null;

  const errors = [];
  for (const user of [{ id: "stranger", role: "INSTRUCTOR" }, { id: "owner", role: "INSTRUCTOR" }]) {
    try {
      await insightsService.assertInstructorCourseAccess(user, "whatever");
    } catch (e) {
      errors.push({ status: e.statusCode, message: e.message });
    }
  }

  assert.deepStrictEqual(errors[0], errors[1], "identical refusal, so nothing can be enumerated");
});

test("security: the signal query cannot be run unbounded", async (t) => {
  // Neither a student nor a course: an installation-wide scan of every
  // learner's evidence is never a legitimate request.
  await assert.rejects(
    () => retentionService.fetchSignalRows({}),
    (error) => error.statusCode === 400
  );
});

test("security: no adaptive payload carries an answer key or model internals", async (t) => {
  stubPipeline(t, {
    masteries: [mastery("Inheritance", "WEAK")],
    gaps: [{ concept: "Inheritance", kc: "Inheritance", status: "OPEN", severity: 0.8, type: "TERMINOLOGY_CONFUSION" }],
    topics: [topicRow("t1", "Inheritance")],
    attempts: [attemptRow("Inheritance", { isCorrect: false }), attemptRow("Inheritance", { isCorrect: false })],
    signals: [signalRow("Recursion", { delayedAnswered: 3, delayedCorrect: 0 })],
    path: [pathEntry({ status: "CURRENT", skippable: true, qualifyingQuiz: qualifyingQuiz() })],
    quizAttempts: [{ attemptNumber: 1, passed: false, percentage: 40 }]
  });

  const json = JSON.stringify({
    recommendations: await recommend(),
    nextAction: await decide(),
    signals: await retentionService.getLearningSignals(STUDENT, { courseId: COURSE, now: NOW })
  });

  for (const forbidden of ["correctAnswer", "explanation", "masteryScore", "masteryProbability", "confidenceLevel", "systemPrompt"]) {
    assert.ok(!json.includes(forbidden), `${forbidden} must never reach a student payload`);
  }
});
