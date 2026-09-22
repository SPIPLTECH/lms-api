const test = require("node:test");
const assert = require("node:assert");

const {
  resolveQualificationTarget,
  QUALIFYING_TAG
} = require("../src/utils/qualification");
const {
  buildLearningPath,
  resolveAccess,
  resolveNextItem,
  PATH_STATUS
} = require("../src/utils/learningPath");
const {
  summarizeWeakConcepts,
  buildQualificationOutcome
} = require("../src/utils/qualificationResult");
const { createQuizSchema } = require("../src/modules/quizzes/quiz.validation");
const quizService = require("../src/modules/quizzes/quiz.service");
const prisma = require("../src/config/database");

// The invariants under test, for sequential learning with a qualifying test:
//
//  1. A qualifying test unlocks ONLY the lesson/topic it is attached to.
//  2. Passing is the existing deterministic decision (QuizAttempt.passed,
//     against the quiz's own passingScore) — never a fresh judgement here,
//     and never an LLM's.
//  3. A pass makes the target skippable-past WITHOUT making it "completed":
//     progression treats them alike, reporting keeps them apart.
//  4. A fail unlocks nothing and sends the student back to real content.
//  5. Locking is positional: everything after the first unfinished node is
//     locked, and finished/qualified material stays open for review.

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const node = (id, title, overrides = {}) => ({
  id,
  title,
  applicable: true,
  completed: false,
  qualified: false,
  qualifiedAt: null,
  satisfied: false,
  progressPercent: 0,
  totalItems: 2,
  completedItems: 0,
  ...overrides
});

/** Module 1 { Lesson 1 [Topic 1, Topic 2], Lesson 2 }, Module 2 { Lesson 3 }. */
const buildHierarchy = (overrides = {}) => ({
  id: "course-1",
  title: "Course",
  modules: [
    {
      ...node("m1", "Module 1"),
      lessons: [
        {
          ...node("l1", "Lesson 1"),
          topics: [
            { ...node("t1", "Variables"), ...(overrides.t1 || {}) },
            { ...node("t2", "Data Types"), ...(overrides.t2 || {}) }
          ],
          ...(overrides.l1 || {})
        },
        { ...node("l2", "Lesson 2"), topics: [], ...(overrides.l2 || {}) }
      ],
      ...(overrides.m1 || {})
    },
    {
      ...node("m2", "Module 2"),
      lessons: [{ ...node("l3", "Lesson 3"), topics: [], ...(overrides.l3 || {}) }],
      ...(overrides.m2 || {})
    }
  ]
});

const noQuizzes = { byTopicId: new Map(), byLessonId: new Map() };

const quizzesFor = ({ topics = {}, lessons = {} } = {}) => ({
  byTopicId: new Map(Object.entries(topics)),
  byLessonId: new Map(Object.entries(lessons))
});

const qualifyingQuiz = (targetId, targetKind, passingScore = 70) => ({
  id: `qq-${targetId}`,
  title: `Qualifying test for ${targetId}`,
  passingScore,
  attempts: 1,
  timeLimit: null,
  questionCount: 5,
  targetKind,
  targetId
});

const statusOf = (path, id) => path.find((entry) => entry.id === id)?.status;
const entryOf = (path, id) => path.find((entry) => entry.id === id);

// ---------------------------------------------------------------------------
// Target association
// ---------------------------------------------------------------------------

test("resolveQualificationTarget — only a QUALIFYING quiz has a target", () => {
  assert.strictEqual(
    resolveQualificationTarget({ quizTag: "FINAL", topicId: "t1" }),
    null,
    "a Final is ordinary assessment, it unlocks nothing"
  );
  assert.strictEqual(resolveQualificationTarget({ quizTag: "SELF_TEST", topicId: "t1" }), null);
  assert.strictEqual(resolveQualificationTarget(null), null);
});

test("resolveQualificationTarget — a qualifying quiz targets exactly what it is attached to", () => {
  assert.deepStrictEqual(
    resolveQualificationTarget({ quizTag: QUALIFYING_TAG, topicId: "t1", lessonId: null }),
    { kind: "TOPIC", id: "t1", field: "topicId" }
  );
  assert.deepStrictEqual(
    resolveQualificationTarget({ quizTag: QUALIFYING_TAG, topicId: null, lessonId: "l1" }),
    { kind: "LESSON", id: "l1", field: "lessonId" }
  );
  // Both set: the finest scope wins, so it can never quietly unlock the whole
  // lesson when it was authored against one topic.
  assert.deepStrictEqual(
    resolveQualificationTarget({ quizTag: QUALIFYING_TAG, topicId: "t1", lessonId: "l1" }),
    { kind: "TOPIC", id: "t1", field: "topicId" }
  );
});

test("resolveQualificationTarget — a qualifying quiz with no lesson/topic unlocks nothing", () => {
  assert.strictEqual(
    resolveQualificationTarget({ quizTag: QUALIFYING_TAG, topicId: null, lessonId: null, moduleId: "m1" }),
    null,
    "module/course scope is not a skip target"
  );
});

test("createQuiz — a qualifying test must name what it lets the student skip", async (t) => {
  const originals = { courseFindUnique: prisma.course.findUnique };
  t.after(() => {
    prisma.course.findUnique = originals.courseFindUnique;
  });
  prisma.course.findUnique = async () => ({ id: "c1" });

  await assert.rejects(
    () =>
      quizService.createQuiz({
        title: "Skip test",
        courseId: "c1",
        quizTag: "QUALIFYING",
        passingScore: 70
      }),
    (error) => error.statusCode === 400 && /lesson or topic/i.test(error.message),
    "a qualifying quiz with no target is refused rather than saved useless"
  );
});

test("createQuizSchema — QUALIFYING is an accepted tag, nonsense still isn't", () => {
  const base = { title: "T", courseId: "c1", passingScore: 70 };
  assert.strictEqual(createQuizSchema.validate({ ...base, quizTag: "QUALIFYING" }).error, undefined);
  assert.ok(createQuizSchema.validate({ ...base, quizTag: "SKIP_TEST" }).error);
});

// ---------------------------------------------------------------------------
// Sequential locking
// ---------------------------------------------------------------------------

test("learning path — a fresh course opens at its first topic, not its first module", () => {
  const path = buildLearningPath(buildHierarchy(), noQuizzes);

  assert.deepStrictEqual(
    path.map((entry) => entry.id),
    ["m1", "l1", "t1", "t2", "l2", "m2", "l3"],
    "gate nodes come out in course order"
  );

  // A container is unfinished BECAUSE its children are, so it must not lock
  // them — a module that gated its own lessons would make the course
  // impossible to start.
  assert.strictEqual(statusOf(path, "t1"), PATH_STATUS.CURRENT, "the first real piece of work");
  assert.strictEqual(entryOf(path, "m1").locked, false, "a module never locks its own lessons");
  assert.strictEqual(entryOf(path, "l1").locked, false, "a lesson never locks its own topics");

  for (const id of ["t2", "l2", "m2", "l3"]) {
    assert.strictEqual(statusOf(path, id), PATH_STATUS.LOCKED, `${id} is not reachable yet`);
  }
});

test("learning path — an unfinished container never locks its own descendants", () => {
  // The regression this guards: a module is unfinished precisely because its
  // lessons are, so treating it as a gate like any other node locked every
  // lesson inside it — and with the first module unfinished by definition at
  // the start, that locked the entire course for every student.
  const path = buildLearningPath(buildHierarchy(), noQuizzes);

  const lockedIds = path.filter((entry) => entry.locked).map((entry) => entry.id);
  assert.ok(!lockedIds.includes("l1"), "Module 1 must not lock its own Lesson 1");
  assert.ok(!lockedIds.includes("t1"), "Lesson 1 must not lock its own Topic 1");
  // A sibling that genuinely comes later is still gated.
  assert.ok(lockedIds.includes("l2"), "Lesson 2 comes after unfinished work and stays locked");
});

test("learning path — finishing in order moves the frontier forward", () => {
  const done = { completed: true, satisfied: true, progressPercent: 100 };
  const path = buildLearningPath(
    buildHierarchy({ m1: done, l1: done, t1: done }),
    noQuizzes
  );

  assert.strictEqual(statusOf(path, "t1"), PATH_STATUS.COMPLETED);
  assert.strictEqual(statusOf(path, "t2"), PATH_STATUS.CURRENT);
  assert.strictEqual(statusOf(path, "l2"), PATH_STATUS.LOCKED);
  assert.strictEqual(resolveNextItem(path).id, "t2");
});

test("learning path — a node with nothing to track never blocks the course", () => {
  // An empty topic can never become `completed`, so treating it as a gate
  // would lock the rest of the course forever.
  const path = buildLearningPath(
    buildHierarchy({
      m1: { completed: true, satisfied: true },
      l1: { completed: true, satisfied: true },
      t1: { applicable: false, totalItems: 0 }
    }),
    noQuizzes
  );

  assert.notStrictEqual(statusOf(path, "t2"), PATH_STATUS.LOCKED, "the empty topic did not block its sibling");
  assert.strictEqual(statusOf(path, "t2"), PATH_STATUS.CURRENT);
});

test("learning path — completed material stays open for review", () => {
  const done = { completed: true, satisfied: true };
  const path = buildLearningPath(buildHierarchy({ m1: done, l1: done, t1: done }), noQuizzes);

  assert.strictEqual(entryOf(path, "t1").locked, false, "you can always go back");
  assert.strictEqual(resolveAccess(path, { topicId: "t1" }).allowed, true);
});

// ---------------------------------------------------------------------------
// Qualification
// ---------------------------------------------------------------------------

test("learning path — a skip is only offered where a qualifying test exists and is needed", () => {
  const path = buildLearningPath(
    buildHierarchy({ m1: { completed: true, satisfied: true }, l1: { completed: true, satisfied: true } }),
    quizzesFor({
      topics: { t1: qualifyingQuiz("t1", "TOPIC"), t2: qualifyingQuiz("t2", "TOPIC") }
    })
  );

  assert.strictEqual(entryOf(path, "t1").skippable, true, "t1 is current and has a test");
  assert.strictEqual(entryOf(path, "t1").qualifyingQuiz.id, "qq-t1");
  assert.strictEqual(entryOf(path, "t2").skippable, false, "t2 is still locked — not their problem yet");
  assert.strictEqual(entryOf(path, "l2").skippable, false, "no qualifying test attached");
  assert.strictEqual(entryOf(path, "l2").qualifyingQuiz, null);
});

test("learning path — an already-finished node offers no skip", () => {
  const done = { completed: true, satisfied: true };
  const path = buildLearningPath(
    buildHierarchy({ m1: done, l1: done, t1: done }),
    quizzesFor({ topics: { t1: qualifyingQuiz("t1", "TOPIC") } })
  );

  assert.strictEqual(entryOf(path, "t1").skippable, false, "nothing left to skip");
});

test("learning path — qualifying out of a topic unlocks what follows it, and only that", () => {
  const done = { completed: true, satisfied: true };
  const path = buildLearningPath(
    buildHierarchy({
      m1: done,
      l1: done,
      // t1 was skipped after passing its qualifying test.
      t1: { qualified: true, qualifiedAt: new Date("2026-09-17"), satisfied: true }
    }),
    quizzesFor({ topics: { t1: qualifyingQuiz("t1", "TOPIC") } })
  );

  const t1 = entryOf(path, "t1");
  assert.strictEqual(t1.status, PATH_STATUS.QUALIFIED);
  assert.strictEqual(t1.qualified, true);
  assert.strictEqual(t1.completed, false, "qualified is NOT completed");
  assert.strictEqual(t1.satisfied, true, "but it no longer stands in the way");
  assert.strictEqual(t1.locked, false, "the skipped topic is still openable");

  assert.strictEqual(statusOf(path, "t2"), PATH_STATUS.CURRENT, "the very next node opened");
  // The unlock is positional, not global: a pass did not open the whole course.
  assert.strictEqual(statusOf(path, "l2"), PATH_STATUS.LOCKED);
  assert.strictEqual(statusOf(path, "m2"), PATH_STATUS.LOCKED);
  assert.strictEqual(statusOf(path, "l3"), PATH_STATUS.LOCKED);
});

test("learning path — a skipped lesson's own topics stop blocking what follows it", () => {
  // The point of skipping Lesson 1 is not having to do its topics. Those
  // topics therefore stay incomplete forever — and if they still counted as
  // outstanding work they would block Lesson 2, and the skip would have
  // bought the student nothing at all.
  const path = buildLearningPath(
    buildHierarchy({
      m1: { completed: true, satisfied: true },
      l1: { qualified: true, satisfied: true },
      // t1/t2 were never touched, and never will be.
    }),
    noQuizzes
  );

  assert.strictEqual(statusOf(path, "l1"), PATH_STATUS.QUALIFIED);
  assert.strictEqual(statusOf(path, "l2"), PATH_STATUS.CURRENT, "the next lesson is now the student's work");
  assert.strictEqual(entryOf(path, "t1").locked, false, "a skipped lesson's topics stay readable");
  assert.strictEqual(entryOf(path, "t2").locked, false);
});

test("learning path — qualifying does not leak past the node it belongs to", () => {
  // A pass recorded against Lesson 2 must not open Module 2 while Lesson 1 is
  // still unfinished: qualification removes ONE obstacle, not the queue.
  const path = buildLearningPath(
    buildHierarchy({
      m1: { completed: true, satisfied: true },
      l2: { qualified: true, satisfied: true }
    }),
    noQuizzes
  );

  assert.strictEqual(statusOf(path, "t1"), PATH_STATUS.CURRENT, "Lesson 1's first topic is still the student's job");
  assert.strictEqual(entryOf(path, "l1").satisfied, false, "Lesson 1 is not done");
  assert.strictEqual(statusOf(path, "m2"), PATH_STATUS.LOCKED, "and Module 2 stays shut");
});

// ---------------------------------------------------------------------------
// Backend access enforcement
// ---------------------------------------------------------------------------

test("resolveAccess — locked content is refused with a reason", () => {
  const path = buildLearningPath(buildHierarchy(), noQuizzes);

  const denied = resolveAccess(path, { topicId: "t2" });
  assert.strictEqual(denied.allowed, false);
  assert.match(denied.reason, /Data Types/, "the refusal names what was asked for");

  assert.strictEqual(resolveAccess(path, { lessonId: "l3" }).allowed, false);
  // Nothing asked for: nothing to refuse.
  assert.strictEqual(resolveAccess(path, {}).allowed, true);
  // An id this course knows nothing about isn't this check's business.
  assert.strictEqual(resolveAccess(path, { topicId: "not-in-course" }).allowed, true);
});

test("resolveAccess — a qualified skip is what opens the door, not a bare pass", () => {
  const done = { completed: true, satisfied: true };
  const before = buildLearningPath(buildHierarchy({ m1: done, l1: done }), noQuizzes);
  assert.strictEqual(resolveAccess(before, { topicId: "t2" }).allowed, false);

  const after = buildLearningPath(
    buildHierarchy({ m1: done, l1: done, t1: { qualified: true, satisfied: true } }),
    noQuizzes
  );
  assert.strictEqual(resolveAccess(after, { topicId: "t2" }).allowed, true);
});

// ---------------------------------------------------------------------------
// Result: weak areas and recommendations
// ---------------------------------------------------------------------------

const questionRow = (concept, { answered = true, isCorrect = true } = {}) => ({
  answered,
  isCorrect: answered ? isCorrect : null,
  question: { topic: concept }
});

test("summarizeWeakConcepts — counts only what actually went wrong, worst first", () => {
  const weak = summarizeWeakConcepts([
    questionRow("Variables", { isCorrect: false }),
    questionRow("Variables", { isCorrect: false }),
    questionRow("Variables", { isCorrect: true }),
    questionRow("Scope", { isCorrect: false }),
    questionRow("Data Types", { isCorrect: true })
  ]);

  assert.deepStrictEqual(
    weak.map((w) => w.concept),
    ["Variables", "Scope"],
    "a concept they got right is not a weak area"
  );
  assert.strictEqual(weak[0].missed, 2);
  assert.strictEqual(weak[0].asked, 3);
  assert.strictEqual(weak[0].accuracy, 33);
});

test("summarizeWeakConcepts — an unanswered question counts as not demonstrated", () => {
  const weak = summarizeWeakConcepts([questionRow("Scope", { answered: false })]);
  assert.strictEqual(weak.length, 1);
  assert.strictEqual(weak[0].unanswered, 1);
  assert.strictEqual(weak[0].incorrect, 0);
  assert.strictEqual(weak[0].missed, 1);
});

test("summarizeWeakConcepts — an untagged question is not invented into a concept", () => {
  const weak = summarizeWeakConcepts([
    questionRow("General", { isCorrect: false }),
    questionRow("", { isCorrect: false }),
    questionRow(null, { isCorrect: false })
  ]);
  assert.deepStrictEqual(weak, [], "no placeholder concepts in a student-facing report");
});

test("buildQualificationOutcome — a pass qualifies and recommends nothing", async () => {
  const outcome = await buildQualificationOutcome(
    { quizTag: QUALIFYING_TAG, topicId: "t1", passingScore: 70 },
    {
      id: "attempt-1",
      attemptNumber: 1,
      passed: true,
      percentage: 80,
      questionAttempts: [questionRow("Variables", { isCorrect: false })]
    }
  );

  assert.strictEqual(outcome.qualified, true);
  assert.strictEqual(outcome.target.kind, "TOPIC");
  assert.strictEqual(outcome.target.id, "t1");
  assert.strictEqual(outcome.percentage, 80);
  assert.strictEqual(outcome.passingScore, 70);
  assert.deepStrictEqual(outcome.recommendedContent, [], "they qualified — nothing to send them back to");
  assert.deepStrictEqual(outcome.weakConcepts, []);
});

test("buildQualificationOutcome — a fail recommends the topic behind the wrong answers", async (t) => {
  const originals = { topicFindUnique: prisma.topic.findUnique };
  t.after(() => {
    prisma.topic.findUnique = originals.topicFindUnique;
  });
  prisma.topic.findUnique = async () => ({
    id: "t1",
    title: "Variables",
    lessonId: "l1",
    isPublished: true
  });

  const outcome = await buildQualificationOutcome(
    { quizTag: QUALIFYING_TAG, topicId: "t1", passingScore: 70 },
    {
      id: "attempt-1",
      attemptNumber: 1,
      passed: false,
      percentage: 60,
      questionAttempts: [
        questionRow("Variables", { isCorrect: false }),
        questionRow("Variables", { isCorrect: true })
      ]
    }
  );

  assert.strictEqual(outcome.qualified, false);
  assert.strictEqual(outcome.weakConcepts[0].concept, "Variables");
  assert.strictEqual(outcome.recommendedContent.length, 1);
  assert.strictEqual(outcome.recommendedContent[0].id, "t1");
  assert.deepStrictEqual(
    outcome.recommendedContent[0].matchedConcepts,
    ["Variables"],
    "the recommendation is tied to the concept they actually missed"
  );
});

test("buildQualificationOutcome — a lesson target recommends the topics that were missed", async (t) => {
  const originals = { lessonFindUnique: prisma.lesson.findUnique };
  t.after(() => {
    prisma.lesson.findUnique = originals.lessonFindUnique;
  });
  prisma.lesson.findUnique = async () => ({
    id: "l1",
    title: "Java Basics",
    moduleId: "m1",
    isPublished: true,
    topics: [
      { id: "t1", title: "Variables", lessonId: "l1" },
      { id: "t2", title: "Data Types", lessonId: "l1" },
      { id: "t3", title: "Operators", lessonId: "l1" }
    ]
  });

  const outcome = await buildQualificationOutcome(
    { quizTag: QUALIFYING_TAG, lessonId: "l1", passingScore: 70 },
    {
      id: "attempt-1",
      attemptNumber: 1,
      passed: false,
      percentage: 40,
      questionAttempts: [
        questionRow("Variables", { isCorrect: false }),
        questionRow("Data Types", { isCorrect: false }),
        questionRow("Operators", { isCorrect: true })
      ]
    }
  );

  assert.deepStrictEqual(
    outcome.recommendedContent.map((r) => r.title),
    ["Variables", "Data Types"],
    "only the topics behind the wrong answers, not the whole lesson"
  );
});

test("buildQualificationOutcome — with nothing to go on, the whole target is the recommendation", async (t) => {
  const originals = { lessonFindUnique: prisma.lesson.findUnique };
  t.after(() => {
    prisma.lesson.findUnique = originals.lessonFindUnique;
  });
  prisma.lesson.findUnique = async () => ({
    id: "l1",
    title: "Java Basics",
    moduleId: "m1",
    isPublished: true,
    topics: [
      { id: "t1", title: "Variables", lessonId: "l1" },
      { id: "t2", title: "Data Types", lessonId: "l1" }
    ]
  });

  // Untagged questions: no concept can be attributed, so narrowing the
  // recommendation would be guessing.
  const outcome = await buildQualificationOutcome(
    { quizTag: QUALIFYING_TAG, lessonId: "l1", passingScore: 70 },
    {
      id: "attempt-1",
      attemptNumber: 1,
      passed: false,
      percentage: 10,
      questionAttempts: [questionRow("General", { isCorrect: false })]
    }
  );

  assert.deepStrictEqual(outcome.weakConcepts, []);
  assert.deepStrictEqual(
    outcome.recommendedContent.map((r) => r.title),
    ["Variables", "Data Types"],
    "the student works through the lesson as it stands"
  );
});

test("buildQualificationOutcome — an ordinary quiz has no qualification outcome at all", async () => {
  for (const tag of ["FINAL", "SELF_TEST"]) {
    const outcome = await buildQualificationOutcome(
      { quizTag: tag, topicId: "t1", passingScore: 70 },
      { id: "a1", attemptNumber: 1, passed: true, percentage: 90, questionAttempts: [] }
    );
    assert.strictEqual(outcome, null, `${tag} must never unlock anything`);
  }
});

// ---------------------------------------------------------------------------
// Phase 11 — a skip is only offered while the student could actually take it.
//
// The defect: a student who had spent the qualifying allowance was still shown
// "take a short qualifying test to skip this lesson", walked into the quiz,
// answered every question, and was refused at submit under a header reading
// "Attempt 2 of 1".
// ---------------------------------------------------------------------------

const { buildLearningPath: buildPathForAllowance } = require("../src/utils/learningPath");

const allowanceHierarchy = () => ({
  modules: [
    {
      id: "m1", title: "M1", completed: false, satisfied: false,
      lessons: [
        { id: "l1", title: "L1", completed: false, satisfied: false, qualified: false, topics: [] }
      ]
    }
  ]
});

const quizFor = (overrides = {}) => ({
  byTopicId: new Map(),
  byLessonId: new Map([
    ["l1", { id: "qq-1", title: "Qualifying Test", passingScore: 70, attempts: 1, questionCount: 4, ...overrides }]
  ])
});

test("a skip stays on offer while an attempt remains", () => {
  const path = buildPathForAllowance(allowanceHierarchy(), quizFor({ attemptsUsed: 0, canAttempt: true }));
  assert.strictEqual(path.find((e) => e.id === "l1").skippable, true);
});

test("a spent qualifying allowance withdraws the skip offer", () => {
  const path = buildPathForAllowance(allowanceHierarchy(), quizFor({ attemptsUsed: 1, canAttempt: false }));
  const lesson = path.find((e) => e.id === "l1");

  assert.strictEqual(lesson.skippable, false, "no invitation the system will refuse");
  assert.ok(lesson.qualifyingQuiz, "the quiz is still reported, so the result stays reachable");
});

test("a caller with no studentId keeps the behaviour it always had", () => {
  // dripAccess resolves qualifying quizzes without a student, so canAttempt is
  // undefined there and must not read as "no".
  const path = buildPathForAllowance(allowanceHierarchy(), quizFor());
  assert.strictEqual(path.find((e) => e.id === "l1").skippable, true);
});
