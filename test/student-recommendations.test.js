const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const recommendations = require("../src/modules/learner-model/recommendation.service");
const learnerModelService = require("../src/modules/learner-model/learnerModel.service");
const { PEDAGOGICAL_STRATEGIES } = require("../src/modules/learner-model/decision.config");
const retentionService = require("../src/modules/learner-model/retention.service");

// The invariants under test, for student-facing recommendations:
//
//  1. The DECISION is the existing deterministic engine's. This module asks
//     evaluatePedagogicalDecision and respects the answer — it does not have
//     rules of its own about mastery.
//  2. Nothing is recommended without evidence, and nothing is recommended
//     that the student cannot actually open. A dead card is worse than none.
//  3. A student is never told something the evidence doesn't support, and is
//     never shown internal model numbers.
//  4. A student can only ever reach their own state.

const STUDENT = { id: "student-1", userId: "user-1" };

const mastery = (concept, status, overrides = {}) => ({
  concept,
  status,
  masteryScore: status === "MASTERED" ? 0.92 : status === "WEAK" ? 0.2 : 0.55,
  confidenceLevel: 0.8,
  attemptsCount: 5,
  recentScores: [],
  trend: "STABLE",
  lastCourseId: "course-1",
  updatedAt: new Date(),
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

/**
 * Stubs the five reads getRecommendations makes.
 *
 * `settledTopicIds` is the student's completed/qualified topics — a target
 * has to be one of them to be recommendable, since a recommendation is
 * always to go back over something. It defaults to every stubbed topic so
 * the tests below stay about the decision logic they were written for;
 * the gating itself is exercised explicitly further down.
 */
function stubModel(
  t,
  { masteries = [], gaps = [], attempts = [], topics = [], settledTopicIds = null, signals = [] }
) {
  const originals = {
    conceptFindMany: prisma.conceptMastery.findMany,
    gapFindMany: prisma.knowledgeGap.findMany,
    questionAttemptFindMany: prisma.questionAttempt.findMany,
    topicFindMany: prisma.topic.findMany,
    topicProgressFindMany: prisma.topicProgress.findMany,
    learningSignals: retentionService.getLearningSignals
  };

  t.after(() => {
    prisma.conceptMastery.findMany = originals.conceptFindMany;
    prisma.knowledgeGap.findMany = originals.gapFindMany;
    prisma.questionAttempt.findMany = originals.questionAttemptFindMany;
    prisma.topic.findMany = originals.topicFindMany;
    prisma.topicProgress.findMany = originals.topicProgressFindMany;
    retentionService.getLearningSignals = originals.learningSignals;
  });

  const settled = settledTopicIds ?? topics.map((topic) => topic.id);

  prisma.conceptMastery.findMany = async () => masteries;
  prisma.knowledgeGap.findMany = async () => gaps;
  prisma.questionAttempt.findMany = async () => attempts;
  prisma.topic.findMany = async () => topics;
  prisma.topicProgress.findMany = async () => settled.map((topicId) => ({ topicId }));
  // Phase 8 signals default to empty, so every test written before Phase 8
  // still exercises exactly the mastery path it was written for — and none of
  // them reach the database for it.
  retentionService.getLearningSignals = async () => ({
    signals,
    calibration: { status: "UNAVAILABLE", observations: 0 }
  });
}

const run = (opts = {}) => recommendations.getRecommendations(STUDENT, { courseId: "course-1", ...opts });

// ---------------------------------------------------------------------------
// Empty and complete states
// ---------------------------------------------------------------------------

test("a student with no activity gets nothing, not filler", async (t) => {
  stubModel(t, { masteries: [] });

  const result = await run();

  assert.deepStrictEqual(result.recommendations, []);
  assert.deepStrictEqual(result.weakAreas, []);
  assert.deepStrictEqual(result.masteryOverview, []);
});

test("a student who has mastered everything is recommended nothing", async (t) => {
  stubModel(t, {
    masteries: [mastery("Inheritance", "MASTERED"), mastery("Generics", "MASTERED")],
    topics: [topicRow("t1", "Inheritance"), topicRow("t2", "Generics")],
    attempts: [attemptRow("Inheritance"), attemptRow("Generics")]
  });

  const result = await run();

  // The engine answers ADVANCE/CHALLENGE for these, which are not things to
  // put in front of a student as work to do.
  assert.deepStrictEqual(result.recommendations, [], "nothing to fix means nothing to show");
  assert.deepStrictEqual(result.weakAreas, []);
  assert.strictEqual(result.masteryOverview.length, 2, "but their standing is still reported");
  assert.strictEqual(result.masteryOverview[0].masteryLabel, "Strong");
});

// ---------------------------------------------------------------------------
// Evidence drives the recommendation
// ---------------------------------------------------------------------------

test("a weak concept with real evidence is recommended, with a reason from the student's own answers", async (t) => {
  stubModel(t, {
    masteries: [mastery("Inheritance", "WEAK")],
    topics: [topicRow("t1", "Inheritance")],
    attempts: [
      attemptRow("Inheritance", { isCorrect: false }),
      attemptRow("Inheritance", { isCorrect: false }),
      attemptRow("Inheritance", { isCorrect: false }),
      attemptRow("Inheritance", { isCorrect: true })
    ]
  });

  const [rec] = (await run()).recommendations;

  assert.strictEqual(rec.concept, "Inheritance");
  assert.strictEqual(rec.type, "REVIEW_CONCEPT");
  assert.match(rec.reason, /missed 3 questions/i, "the reason cites what actually happened");
  assert.strictEqual(rec.action.label, "Review Topic");
  assert.strictEqual(rec.target.topicId, "t1", "it points at real content");
  assert.strictEqual(rec.masteryLabel, "Needs practice");
  assert.deepStrictEqual(rec.evidence, {
    questionsAsked: 4,
    incorrect: 3,
    skipped: 0,
    hintsUsed: 0
  });
});

test("skipping and needing hints produce different reasons from getting it wrong", async (t) => {
  stubModel(t, {
    masteries: [mastery("Scope", "WEAK")],
    topics: [topicRow("t1", "Scope")],
    attempts: [
      attemptRow("Scope", { answered: false, skipped: true }),
      attemptRow("Scope", { answered: false, skipped: true })
    ]
  });
  assert.match((await run()).recommendations[0].reason, /skipped 2 questions/i);
});

test("repeated hint use is a reason; a single hint is not", async (t) => {
  stubModel(t, {
    masteries: [mastery("Generics", "DEVELOPING")],
    topics: [topicRow("t1", "Generics")],
    attempts: [
      attemptRow("Generics", { isCorrect: true, hintViewed: true }),
      attemptRow("Generics", { isCorrect: true, hintViewed: true })
    ]
  });
  assert.match((await run()).recommendations[0].reason, /used hints on 2/i);
});

test("one hint alone never makes a student look weak", async (t) => {
  // A single hint is using a tool the product offers, not a weakness signal.
  const single = recommendations.buildReason(
    { asked: 6, correct: 6, incorrect: 0, skipped: 0, hinted: 1 },
    { strategy: PEDAGOGICAL_STRATEGIES.GUIDED_PRACTICE }
  );
  assert.ok(!/hint/i.test(single), "a lone hint is not reported back as a problem");
});

test("a practice suggestion with no supporting evidence is not shown", async (t) => {
  stubModel(t, {
    // DEVELOPING mastery yields GUIDED_PRACTICE, but nothing went wrong.
    masteries: [mastery("Collections", "DEVELOPING")],
    topics: [topicRow("t1", "Collections")],
    attempts: [attemptRow("Collections", { isCorrect: true })]
  });

  assert.deepStrictEqual(
    (await run()).recommendations,
    [],
    "nothing is recommended merely because it exists"
  );
});

// ---------------------------------------------------------------------------
// Never a broken link
// ---------------------------------------------------------------------------

test("a concept with no matching course content is dropped, not linked nowhere", async (t) => {
  stubModel(t, {
    masteries: [mastery("Inheritance", "WEAK")],
    // No topic in this course is called "Inheritance".
    topics: [topicRow("t1", "Something Else")],
    attempts: [attemptRow("Inheritance", { isCorrect: false }), attemptRow("Inheritance", { isCorrect: false })]
  });

  const result = await run();

  assert.deepStrictEqual(result.recommendations, [], "a card that leads nowhere is worse than none");
  // The weakness is still reported — it just has nothing to link to.
  assert.strictEqual(result.weakAreas.length, 1);
  assert.strictEqual(result.weakAreas[0].concept, "Inheritance");
});

test("concept-to-content matching is exact, never fuzzy", async (t) => {
  const resolved = await (async () => {
    const original = prisma.topic.findMany;
    prisma.topic.findMany = async () => [topicRow("t1", "Java Inheritance Basics")];
    const out = await recommendations.resolveConceptTargets(["Inheritance"], "course-1");
    prisma.topic.findMany = original;
    return out;
  })();

  assert.strictEqual(resolved.size, 0, "a near-miss must not send a student to the wrong lesson");
});

test("an ordinal-numbered topic title still matches its concept", async (t) => {
  // These courses number their topics ("2.1 Boolean Algebra") while questions
  // tag the concept plainly ("Boolean Algebra"). Without normalising the
  // prefix, nothing would ever match and no recommendation could ever link
  // anywhere — found against the real course data.
  const originals = { topics: prisma.topic.findMany, progress: prisma.topicProgress.findMany };
  t.after(() => {
    prisma.topic.findMany = originals.topics;
    prisma.topicProgress.findMany = originals.progress;
  });
  prisma.topic.findMany = async () => [
    topicRow("t1", "2.1 Boolean Algebra"),
    topicRow("t2", "1.6 Number Systems")
  ];
  // Both settled, so this stays a test about title matching alone.
  prisma.topicProgress.findMany = async () => [{ topicId: "t1" }, { topicId: "t2" }];

  const resolved = await recommendations.resolveConceptTargets(
    ["Boolean Algebra", "Number Systems"],
    "course-1",
    STUDENT.id
  );

  assert.strictEqual(resolved.get("Boolean Algebra").topicId, "t1");
  assert.strictEqual(resolved.get("Number Systems").topicId, "t2");
});

test("normalizeConceptKey strips ordinals without enabling partial matching", () => {
  const { normalizeConceptKey: key } = recommendations;

  assert.strictEqual(key("2.1 Boolean Algebra"), key("Boolean Algebra"));
  assert.strictEqual(key("10. Recursion"), key("Recursion"));
  assert.strictEqual(key("  Logic Gates  "), key("logic gates"));
  // Still not a substring match — this is the guard against wrong links.
  assert.notStrictEqual(key("Java Inheritance Basics"), key("Inheritance"));
  // A number that is part of the name is not an ordinal prefix.
  assert.strictEqual(key("3D Graphics"), "3d graphics");
});

test("case and surrounding whitespace still match", async (t) => {
  const originals = { topics: prisma.topic.findMany, progress: prisma.topicProgress.findMany };
  t.after(() => {
    prisma.topic.findMany = originals.topics;
    prisma.topicProgress.findMany = originals.progress;
  });
  prisma.topic.findMany = async () => [topicRow("t1", "  Inheritance  ")];
  prisma.topicProgress.findMany = async () => [{ topicId: "t1" }];

  const resolved = await recommendations.resolveConceptTargets(["inheritance"], "course-1", STUDENT.id);
  assert.strictEqual(resolved.get("inheritance").topicId, "t1");
});

// ---------------------------------------------------------------------------
// Ordering, de-duplication and limits
// ---------------------------------------------------------------------------

test("the most urgent recommendation leads, and each concept appears once", async (t) => {
  stubModel(t, {
    masteries: [
      mastery("Collections", "DEVELOPING"),
      mastery("Inheritance", "WEAK"),
      mastery("Exceptions", "WEAK")
    ],
    gaps: [{ concept: "Inheritance", severity: 0.9, status: "OPEN" }],
    topics: [topicRow("t1", "Collections"), topicRow("t2", "Inheritance"), topicRow("t3", "Exceptions")],
    attempts: [
      attemptRow("Inheritance", { isCorrect: false }),
      attemptRow("Inheritance", { isCorrect: false }),
      attemptRow("Exceptions", { isCorrect: false }),
      attemptRow("Collections", { isCorrect: false }),
      attemptRow("Collections", { isCorrect: false })
    ]
  });

  const { recommendations: recs } = await run();

  // An active misconception is HIGH priority in the existing engine.
  assert.strictEqual(recs[0].concept, "Inheritance");
  const concepts = recs.map((r) => r.concept);
  assert.strictEqual(new Set(concepts).size, concepts.length, "no concept is recommended twice");
});

test("the dashboard is not flooded — the limit is respected", async (t) => {
  const many = ["A", "B", "C", "D", "E", "F"];
  stubModel(t, {
    masteries: many.map((c) => mastery(c, "WEAK")),
    topics: many.map((c, i) => topicRow(`t${i}`, c)),
    attempts: many.flatMap((c) => [
      attemptRow(c, { isCorrect: false }),
      attemptRow(c, { isCorrect: false })
    ])
  });

  assert.strictEqual((await run({ limit: 3 })).recommendations.length, 3);
});

// ---------------------------------------------------------------------------
// What a student is and isn't told
// ---------------------------------------------------------------------------

test("internal model numbers never reach the student", async (t) => {
  stubModel(t, {
    masteries: [mastery("Inheritance", "WEAK")],
    topics: [topicRow("t1", "Inheritance")],
    attempts: [attemptRow("Inheritance", { isCorrect: false }), attemptRow("Inheritance", { isCorrect: false })]
  });

  const result = await run();
  const json = JSON.stringify(result);

  assert.ok(!json.includes("masteryScore"), "no raw mastery probability");
  assert.ok(!json.includes("confidenceLevel"), "no confidence value");
  assert.ok(!json.includes("0.2"), "no internal estimate leaks as a number");
  // The student gets a word, not a score.
  assert.strictEqual(result.recommendations[0].masteryLabel, "Needs practice");
});

test("weak areas report only assessed concepts", async (t) => {
  stubModel(t, {
    masteries: [
      mastery("Inheritance", "WEAK"),
      mastery("Generics", "DEVELOPING"),
      mastery("Threads", "UNASSESSED"),
      mastery("Collections", "MASTERED")
    ],
    topics: [],
    attempts: []
  });

  const { weakAreas } = await run();

  assert.deepStrictEqual(
    weakAreas.map((w) => w.concept),
    ["Inheritance", "Generics"],
    "unassessed is an absence of information, not a weakness"
  );
  assert.strictEqual(weakAreas[0].summary, "Needs more practice");
  assert.strictEqual(weakAreas[1].summary, "Review recommended");
});

test("internal knowledge-component identifiers are never shown to the student", async (t) => {
  // Regression, caught against live data: a question with no curated topic
  // gets a synthetic `question:<id>` KC (quiz.service mints it so untagged
  // questions don't share one mastery bucket). Those were surfacing verbatim
  // as the student's "weak areas" — meaningless to read, and an internal id.
  stubModel(t, {
    masteries: [
      mastery("question:cmu2lqgza01ioaf1yogf35k33", "WEAK"),
      mastery("General", "WEAK"),
      mastery("Inheritance", "WEAK")
    ],
    topics: [topicRow("t1", "Inheritance")],
    attempts: [attemptRow("Inheritance", { isCorrect: false }), attemptRow("Inheritance", { isCorrect: false })]
  });

  const result = await run();
  const json = JSON.stringify(result);

  assert.ok(!json.includes("question:"), "no synthetic KC identifier reaches the student");
  assert.ok(!json.includes("General"), "no placeholder concept either");
  assert.deepStrictEqual(
    result.weakAreas.map((w) => w.concept),
    ["Inheritance"],
    "only concepts a student can actually recognise"
  );
  assert.strictEqual(result.recommendations.length, 1);
});

test("isStudentFacingConcept — internal bookkeeping stays internal", () => {
  const { isStudentFacingConcept } = recommendations;

  assert.strictEqual(isStudentFacingConcept("Inheritance"), true);
  assert.strictEqual(isStudentFacingConcept("question:abc123"), false);
  assert.strictEqual(isStudentFacingConcept("General"), false);
  assert.strictEqual(isStudentFacingConcept("general"), false);
  assert.strictEqual(isStudentFacingConcept("  "), false);
  assert.strictEqual(isStudentFacingConcept(null), false);
});

test("reasons describe behaviour, never pass judgement on the student", async (t) => {
  const reason = recommendations.buildReason(
    { asked: 5, correct: 1, incorrect: 4, skipped: 0, hinted: 0 },
    { strategy: PEDAGOGICAL_STRATEGIES.CONCEPT_REMEDIATION }
  );

  assert.match(reason, /you missed/i);
  assert.ok(
    !/fail|weak|bad|poor|don't understand|do not understand/i.test(reason),
    "the evidence supports what happened, not a verdict about the learner"
  );
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

test("a student cannot ask for another student's recommendations", async (t) => {
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
    (error) => error.statusCode === 403,
    "student isolation is enforced by the shared check, not by the caller"
  );
});

test("a student asking for their own state is allowed", async (t) => {
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

// ---------------------------------------------------------------------------
// The decision stays the existing engine's
// ---------------------------------------------------------------------------

test("an active misconception is treated as urgent, as the existing engine decides", async (t) => {
  stubModel(t, {
    masteries: [mastery("Inheritance", "DEVELOPING")],
    gaps: [{ concept: "Inheritance", severity: 0.95, status: "OPEN" }],
    topics: [topicRow("t1", "Inheritance")],
    attempts: [attemptRow("Inheritance", { isCorrect: false })]
  });

  const [rec] = (await run()).recommendations;

  assert.strictEqual(rec.priority, "HIGH", "priority comes from the decision engine, not from here");
  assert.strictEqual(rec.type, "REVIEW_CONCEPT");
});

test("a closed misconception no longer drives a recommendation", async (t) => {
  stubModel(t, {
    masteries: [mastery("Inheritance", "MASTERED")],
    // getRecommendations only ever reads OPEN gaps.
    gaps: [],
    topics: [topicRow("t1", "Inheritance")],
    attempts: [attemptRow("Inheritance", { isCorrect: true })]
  });

  assert.deepStrictEqual((await run()).recommendations, []);
});

// ---------------------------------------------------------------------------
// A suggestion is always to go BACK over something.
//
// Which means the content it points at must already be settled for this
// student — completed, or qualified out of. A qualifying test deliberately
// asks about material the student has not studied yet, so without this a
// single wrong answer there produced "Review <next topic>" for a topic they
// had never opened.
// ---------------------------------------------------------------------------

test("a topic the student has not completed is never recommended for review", async (t) => {
  stubModel(t, {
    masteries: [mastery("Polymorphism", "WEAK")],
    attempts: [attemptRow("Polymorphism", { isCorrect: false })],
    topics: [topicRow("topic-9", "Polymorphism")],
    // The student has been assessed on it (a qualifying test question) but
    // has never worked through it.
    settledTopicIds: []
  });

  const result = await run();

  assert.deepStrictEqual(result.recommendations, [], "nothing to review yet");
});

test("the same topic becomes recommendable once it is completed", async (t) => {
  stubModel(t, {
    masteries: [mastery("Polymorphism", "WEAK")],
    attempts: [attemptRow("Polymorphism", { isCorrect: false })],
    topics: [topicRow("topic-9", "Polymorphism")],
    settledTopicIds: ["topic-9"]
  });

  const result = await run();

  assert.strictEqual(result.recommendations.length, 1);
  assert.strictEqual(result.recommendations[0].target.topicId, "topic-9");
});

test("a topic qualified out of is still recommendable — skipped is not unseen", async (t) => {
  // TopicProgress.qualified is returned by the same query as completed, so a
  // student who passed the qualifying test and skipped the topic can still be
  // sent back to the material when their mastery says they should be.
  stubModel(t, {
    masteries: [mastery("Inheritance", "WEAK")],
    attempts: [attemptRow("Inheritance", { isCorrect: false })],
    topics: [topicRow("topic-3", "Inheritance")],
    settledTopicIds: ["topic-3"]
  });

  const result = await run();

  assert.strictEqual(result.recommendations.length, 1);
  assert.strictEqual(result.recommendations[0].target.topicId, "topic-3");
});

test("an unreached topic is still reported as a weak area, just not as an action", async (t) => {
  // The evidence is real — it just doesn't support telling the student to go
  // and review something they have never opened. Diagnosis stays, the
  // suggestion goes.
  stubModel(t, {
    masteries: [mastery("Polymorphism", "WEAK")],
    attempts: [attemptRow("Polymorphism", { isCorrect: false })],
    topics: [topicRow("topic-9", "Polymorphism")],
    settledTopicIds: []
  });

  const result = await run();

  assert.deepStrictEqual(result.recommendations, []);
  assert.ok(
    result.weakAreas.some((area) => area.concept === "Polymorphism"),
    "the signal is kept where it belongs"
  );
});

test("the settled-topic lookup is scoped to the student and the course", async (t) => {
  let capturedWhere = null;

  stubModel(t, {
    masteries: [mastery("Polymorphism", "WEAK")],
    attempts: [attemptRow("Polymorphism", { isCorrect: false })],
    topics: [topicRow("topic-9", "Polymorphism")]
  });

  const original = prisma.topicProgress.findMany;
  t.after(() => {
    prisma.topicProgress.findMany = original;
  });
  prisma.topicProgress.findMany = async ({ where }) => {
    capturedWhere = where;
    return [{ topicId: "topic-9" }];
  };

  await run();

  assert.strictEqual(capturedWhere.studentId, STUDENT.id, "never another student's progress");
  assert.strictEqual(capturedWhere.topic.lesson.module.courseId, "course-1");
  assert.deepStrictEqual(capturedWhere.OR, [{ completed: true }, { qualified: true }]);
});

// ---------------------------------------------------------------------------
// Phase 8 — retention and transfer as ADDITIONAL inputs to this same pipeline
//
// The invariant: these add candidates the current-mastery engine structurally
// cannot produce, and they do it without touching that engine or outranking
// it. A Phase 8 candidate is always MEDIUM, so nextAction — which only ever
// promotes HIGH — cannot have its primary decision changed by one.
// ---------------------------------------------------------------------------

const signal = (concept, overrides = {}) => ({
  concept,
  label: "Review recommended",
  detail: "…",
  retention: {
    status: "INSUFFICIENT_EVIDENCE",
    retentionRate: null,
    delayedAnswered: 0,
    delayedCorrect: 0,
    gapDays: 3,
    daysSinceLastSeen: 1,
    dueForReview: false,
    ...(overrides.retention || {})
  },
  transfer: {
    status: "INSUFFICIENT_EVIDENCE",
    distinctCorrectQuestions: 0,
    distinctCorrectQuizzes: 0,
    distinctSeen: 1,
    ...(overrides.transfer || {})
  },
  evidence: { questionsAnswered: 2, correct: 1, distinctQuestionsSeen: 1, lastSeenAt: new Date() }
});

test("a concept the student has mastered but not retained is recommended for review", async (t) => {
  // The case the existing engine cannot see: mastery reads MASTERED, so
  // evaluatePedagogicalDecision answers ADVANCE and the mastery loop drops it.
  // The delayed evidence says otherwise.
  stubModel(t, {
    masteries: [mastery("Recursion", "MASTERED")],
    topics: [topicRow("t7", "Recursion")],
    attempts: [attemptRow("Recursion", { isCorrect: true })],
    signals: [signal("Recursion", { retention: { status: "DECAYED", delayedAnswered: 3, delayedCorrect: 0 } })]
  });

  const [rec] = (await run()).recommendations;

  assert.ok(rec, "the mastery path alone would have produced nothing");
  assert.strictEqual(rec.id, "retention:Recursion");
  assert.strictEqual(rec.type, "REVIEW_CONCEPT");
  assert.strictEqual(rec.target.topicId, "t7");
  assert.match(rec.reason, /didn't go as well/i);
});

test("a Phase 8 candidate is always MEDIUM, so it can never hijack the next action", async (t) => {
  stubModel(t, {
    masteries: [mastery("Recursion", "MASTERED")],
    topics: [topicRow("t7", "Recursion")],
    attempts: [attemptRow("Recursion", { isCorrect: true })],
    signals: [signal("Recursion", { retention: { status: "DECAYED", delayedAnswered: 3, delayedCorrect: 0 } })]
  });

  const [rec] = (await run()).recommendations;

  assert.strictEqual(rec.priority, "MEDIUM", "nextAction only ever promotes HIGH");
});

test("a concept untouched for a fortnight earns a lighter nudge", async (t) => {
  stubModel(t, {
    masteries: [mastery("Generics", "MASTERED")],
    topics: [topicRow("t8", "Generics")],
    attempts: [attemptRow("Generics", { isCorrect: true })],
    signals: [signal("Generics", { retention: { dueForReview: true, daysSinceLastSeen: 30 } })]
  });

  const [rec] = (await run()).recommendations;

  assert.strictEqual(rec.id, "retention:Generics");
  assert.match(rec.reason, /been a while/i);
});

test("reliable but repetitive success earns transfer practice, not a review", async (t) => {
  stubModel(t, {
    masteries: [mastery("Loops", "MASTERED")],
    topics: [topicRow("t9", "Loops")],
    attempts: [attemptRow("Loops", { isCorrect: true })],
    signals: [
      signal("Loops", {
        retention: { status: "RETAINED", delayedAnswered: 3, delayedCorrect: 3 },
        transfer: { status: "REPEATED_ONLY", distinctCorrectQuestions: 1, distinctCorrectQuizzes: 2, distinctSeen: 2 }
      })
    ]
  });

  const [rec] = (await run()).recommendations;

  assert.strictEqual(rec.id, "transfer:Loops");
  assert.strictEqual(rec.type, "PRACTISE_CONCEPT");
  assert.match(rec.title, /Practise applying/i);
});

test("a shaky concept is not offered transfer practice on top of a review", async (t) => {
  // Stacking "review this" and "now try a harder version of it" on one concept
  // is noise, and the harder version is the wrong advice for someone shaky.
  stubModel(t, {
    masteries: [mastery("Loops", "MASTERED")],
    topics: [topicRow("t9", "Loops")],
    attempts: [attemptRow("Loops", { isCorrect: true })],
    signals: [
      signal("Loops", {
        retention: { status: "SHAKY", delayedAnswered: 4, delayedCorrect: 2 },
        transfer: { status: "REPEATED_ONLY", distinctCorrectQuestions: 1, distinctCorrectQuizzes: 2, distinctSeen: 2 }
      })
    ]
  });

  assert.deepStrictEqual((await run()).recommendations, []);
});

test("the mastery engine keeps the floor when both have something to say", async (t) => {
  stubModel(t, {
    masteries: [mastery("Inheritance", "WEAK")],
    topics: [topicRow("t1", "Inheritance")],
    attempts: [
      attemptRow("Inheritance", { isCorrect: false }),
      attemptRow("Inheritance", { isCorrect: false })
    ],
    signals: [signal("Inheritance", { retention: { status: "DECAYED", delayedAnswered: 3, delayedCorrect: 0 } })]
  });

  const { recommendations: recs } = await run();

  assert.strictEqual(recs.length, 1, "one card per concept, not two");
  assert.strictEqual(recs[0].id, "concept:Inheritance", "the existing engine's, not Phase 8's");
  assert.strictEqual(recs[0].priority, "HIGH");
});

test("a Phase 8 signal on unsettled content is dropped like any other", async (t) => {
  // The rule holds for retention too: a suggestion is to go BACK over
  // something, so its target must already be completed or qualified.
  stubModel(t, {
    masteries: [mastery("Recursion", "MASTERED")],
    topics: [topicRow("t7", "Recursion")],
    attempts: [attemptRow("Recursion", { isCorrect: true })],
    settledTopicIds: [],
    signals: [signal("Recursion", { retention: { status: "DECAYED", delayedAnswered: 3, delayedCorrect: 0 } })]
  });

  assert.deepStrictEqual((await run()).recommendations, []);
});

test("signals with no matching content produce nothing, not a dead card", async (t) => {
  stubModel(t, {
    masteries: [mastery("Recursion", "MASTERED")],
    topics: [],
    attempts: [attemptRow("Recursion", { isCorrect: true })],
    signals: [signal("Recursion", { retention: { status: "DECAYED", delayedAnswered: 3, delayedCorrect: 0 } })]
  });

  assert.deepStrictEqual((await run()).recommendations, []);
});

test("Phase 8 adds no card when retention and transfer are both fine", async (t) => {
  stubModel(t, {
    masteries: [mastery("Loops", "MASTERED")],
    topics: [topicRow("t9", "Loops")],
    attempts: [attemptRow("Loops", { isCorrect: true })],
    signals: [
      signal("Loops", {
        retention: { status: "RETAINED", delayedAnswered: 3, delayedCorrect: 3 },
        transfer: { status: "TRANSFERRED", distinctCorrectQuestions: 2, distinctCorrectQuizzes: 2, distinctSeen: 3 }
      })
    ]
  });

  assert.deepStrictEqual((await run()).recommendations, [], "nothing to say is said as nothing");
});

test("Phase 8 candidates expose counts only, never rates or model estimates", async (t) => {
  stubModel(t, {
    masteries: [mastery("Recursion", "MASTERED")],
    topics: [topicRow("t7", "Recursion")],
    attempts: [attemptRow("Recursion", { isCorrect: true })],
    signals: [signal("Recursion", { retention: { status: "DECAYED", delayedAnswered: 3, delayedCorrect: 0 } })]
  });

  const json = JSON.stringify((await run()).recommendations);

  assert.ok(!json.includes("retentionRate"), "a rate reads as a score");
  assert.ok(!json.includes("masteryScore"));
  assert.ok(!json.includes("confidenceLevel"));
});
