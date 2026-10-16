const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const insights = require("../src/modules/learner-model/instructorInsights.service");
const retentionService = require("../src/modules/learner-model/retention.service");
const recommendationService = require("../src/modules/learner-model/recommendation.service");
const nextActionService = require("../src/modules/learner-model/nextAction.service");
const progressService = require("../src/modules/progress/progress.service");
const { ATTENTION_REASON, ATTENTION_CONFIG } = require("../src/modules/learner-model/instructorInsights.config");

// The invariants under test, for Phase 9:
//
//  1. It is OBSERVATIONAL. Nothing here decides anything, and the Phase 8
//     definitions are reused, never restated.
//  2. An instructor sees their own courses and nothing else — and cannot tell
//     "not yours" apart from "does not exist".
//  3. A learner's presence on the attention list is explained by named
//     reasons, never by a single opaque score.
//  4. Absence of evidence is reported as such, never as a zero.
//  5. Aggregation is server-side, with no per-learner query.

const INSTRUCTOR = { id: "user-instructor", role: "INSTRUCTOR" };
const OTHER_INSTRUCTOR = { id: "user-other", role: "INSTRUCTOR" };
const ADMIN = { id: "user-admin", role: "ADMIN" };
const COURSE = "course-1";
const NOW = new Date("2026-03-01T12:00:00.000Z");
const daysBefore = (n) => new Date(NOW.getTime() - n * 86_400_000);

const learner = (id, name, overrides = {}) => ({
  studentId: id,
  progressPercent: 40,
  completed: false,
  lastAccessedAt: daysBefore(1),
  enrolledAt: daysBefore(60),
  student: { id, user: { name, email: `${id}@example.com` } },
  ...overrides
});

/** A (student, concept) row exactly as fetchSignalRows returns it. */
const signalRow = (studentId, concept, overrides = {}) => ({
  studentId,
  concept,
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

const gap = (studentId, overrides = {}) => ({
  studentId,
  concept: "Inheritance",
  kc: "Inheritance",
  type: "TERMINOLOGY_CONFUSION",
  status: "OPEN",
  severity: 0.6,
  detectedAt: daysBefore(5),
  ...overrides
});

const qualifyingRow = (studentId, overrides = {}) => ({
  quizId: "qq-1",
  quizTitle: "Qualifying Test — Classes and Objects",
  allowance: 3,
  lessonTitle: "Classes and Objects",
  topicTitle: null,
  studentId,
  attemptCount: 1,
  passed: false,
  passedOnAttempt: null,
  ...overrides
});

/**
 * Stubs the four aggregated reads, plus the course lookup.
 *
 * `courseOwner` drives the ownership clause the service folds into that
 * lookup, so the authorization tests exercise the real query shape rather
 * than a mock of the decision.
 */
function stubCourse(t, { signalRows = [], gaps = [], qualifying = [], learners = [], courseOwner = INSTRUCTOR.id }) {
  const originals = {
    courseFindFirst: prisma.course.findFirst,
    enrollmentFindMany: prisma.enrollment.findMany,
    queryRaw: prisma.$queryRaw,
    fetchSignalRows: retentionService.fetchSignalRows
  };

  t.after(() => {
    prisma.course.findFirst = originals.courseFindFirst;
    prisma.enrollment.findMany = originals.enrollmentFindMany;
    prisma.$queryRaw = originals.queryRaw;
    retentionService.fetchSignalRows = originals.fetchSignalRows;
  });

  prisma.course.findFirst = async ({ where }) => {
    if (where.id !== COURSE) return null;
    if (where.creatorId && where.creatorId !== courseOwner) return null;
    return { id: COURSE, title: "Java Programming Fundamentals" };
  };

  prisma.enrollment.findMany = async () => learners;
  retentionService.fetchSignalRows = async () => signalRows;

  // The two raw joins are told apart by the SQL text they were given.
  prisma.$queryRaw = async (strings) => {
    const sql = Array.isArray(strings) ? strings.join(" ") : String(strings);
    if (sql.includes("KnowledgeGap")) return gaps;
    if (sql.includes("QuizAttempt")) return qualifying;
    return [];
  };
}

const overview = (user = INSTRUCTOR) => insights.getCourseInsights(user, { courseId: COURSE, now: NOW });
const attention = (user = INSTRUCTOR, opts = {}) =>
  insights.getLearnersNeedingAttention(user, { courseId: COURSE, now: NOW, ...opts });

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

test("the owning instructor can read their course's insights", async (t) => {
  stubCourse(t, { learners: [learner("s1", "Ada")] });

  const result = await overview();

  assert.strictEqual(result.course.title, "Java Programming Fundamentals");
});

test("another instructor's course reads as not found, not as forbidden", async (t) => {
  // Invariant 2. A 403 here would confirm the course id is real, which lets
  // an instructor enumerate the installation one probe at a time.
  stubCourse(t, { learners: [] });

  await assert.rejects(
    () => overview(OTHER_INSTRUCTOR),
    (error) => error.statusCode === 404 && /not found/i.test(error.message)
  );
});

test("a course that does not exist fails identically", async (t) => {
  stubCourse(t, { learners: [] });

  await assert.rejects(
    () => insights.getCourseInsights(INSTRUCTOR, { courseId: "no-such-course", now: NOW }),
    (error) => error.statusCode === 404 && /not found/i.test(error.message)
  );
});

test("an admin is not bound by course ownership", async (t) => {
  stubCourse(t, { learners: [learner("s1", "Ada")], courseOwner: "someone-else" });

  const result = await overview(ADMIN);

  assert.strictEqual(result.course.title, "Java Programming Fundamentals");
});

test("a missing courseId is rejected before any work happens", async () => {
  await assert.rejects(
    () => insights.getCourseInsights(INSTRUCTOR, {}),
    (error) => error.statusCode === 400
  );
});

test("the learner list enforces the same course check", async (t) => {
  stubCourse(t, { learners: [] });

  await assert.rejects(
    () => attention(OTHER_INSTRUCTOR),
    (error) => error.statusCode === 404
  );
});

test("a learner not enrolled on the course cannot be drilled into", async (t) => {
  // Owning the course does not entitle an instructor to an arbitrary student:
  // enrolment on THIS course is the second half of the check.
  stubCourse(t, { learners: [] });

  const original = prisma.enrollment.findUnique;
  t.after(() => {
    prisma.enrollment.findUnique = original;
  });
  prisma.enrollment.findUnique = async () => null;

  await assert.rejects(
    () => insights.getLearnerDetail(INSTRUCTOR, { courseId: COURSE, studentId: "s-elsewhere", now: NOW }),
    (error) => error.statusCode === 404
  );
});

test("the drill-down requires a studentId", async (t) => {
  stubCourse(t, { learners: [] });

  await assert.rejects(
    () => insights.getLearnerDetail(INSTRUCTOR, { courseId: COURSE, now: NOW }),
    (error) => error.statusCode === 400
  );
});

// ---------------------------------------------------------------------------
// Empty states — absence of evidence is not a zero
// ---------------------------------------------------------------------------

test("a course with no learners reports empty sections, not fabricated zeros", async (t) => {
  stubCourse(t, { learners: [] });

  const result = await overview();

  assert.strictEqual(result.summary.learnersEnrolled, 0);
  assert.strictEqual(result.summary.averageProgressPercent, null, "no learners is not 0% progress");
  assert.deepStrictEqual(result.concepts, []);
  assert.deepStrictEqual(result.misconceptions, []);
  assert.deepStrictEqual(result.qualifyingTests, []);
});

test("enrolled learners with no evidence yet are counted but not judged", async (t) => {
  stubCourse(t, { learners: [learner("s1", "Ada"), learner("s2", "Grace")] });

  const result = await overview();

  assert.strictEqual(result.summary.learnersEnrolled, 2);
  assert.strictEqual(result.summary.learnersWithEvidence, 0);
  assert.strictEqual(result.summary.learnersNeedingAttention, 0);
  assert.deepStrictEqual(result.retention, {
    RETAINED: 0, SHAKY: 0, DECAYED: 0, INSUFFICIENT_EVIDENCE: 0
  });
});

test("a qualifying test nobody has passed reports null, not an average of zero", async (t) => {
  // Invariant 4. 0.0 attempts-to-qualify would read as "everyone passed
  // instantly", the exact opposite of the truth.
  stubCourse(t, {
    learners: [learner("s1", "Ada")],
    qualifying: [qualifyingRow("s1", { attemptCount: 2, passed: false })]
  });

  const [quiz] = (await overview()).qualifyingTests;

  assert.strictEqual(quiz.averageAttemptsToQualify, null);
  assert.strictEqual(quiz.passRate, 0);
  assert.strictEqual(quiz.learnersStillTrying, 1);
});

// ---------------------------------------------------------------------------
// Learners needing attention — reasons, not a score
// ---------------------------------------------------------------------------

test("decayed retention puts a learner on the list, and names the concept", async (t) => {
  stubCourse(t, {
    learners: [learner("s1", "Ada")],
    signalRows: [signalRow("s1", "Recursion", { delayedAnswered: 3, delayedCorrect: 0 })]
  });

  const { learners: rows } = await attention();

  assert.strictEqual(rows.length, 1);
  const reason = rows[0].reasons.find((r) => r.code === ATTENTION_REASON.RETENTION_DECAYED);
  assert.ok(reason, "the reason is present");
  assert.match(reason.label, /Recursion/);
});

test("no learner carries a risk score — only named reasons", async (t) => {
  // Invariant 3, pinned explicitly because a score is the easy thing to add
  // later and the hard thing to justify to an instructor.
  stubCourse(t, {
    learners: [learner("s1", "Ada")],
    signalRows: [signalRow("s1", "Recursion", { delayedAnswered: 3, delayedCorrect: 0 })]
  });

  const { learners: rows } = await attention();
  const json = JSON.stringify(rows);

  assert.ok(!json.includes("riskScore"));
  assert.ok(!json.includes("masteryScore"));
  assert.ok(!json.includes("masteryProbability"));
  assert.ok(Array.isArray(rows[0].reasons));
});

test("three incorrect answers on one concept is a reason; two is not", async (t) => {
  stubCourse(t, {
    learners: [learner("s1", "Ada"), learner("s2", "Grace")],
    signalRows: [
      signalRow("s1", "Loops", { answered: 5, correct: 2, delayedAnswered: 0, delayedCorrect: 0 }),
      signalRow("s2", "Loops", { answered: 4, correct: 2, delayedAnswered: 0, delayedCorrect: 0 })
    ]
  });

  const { learners: rows } = await attention();

  assert.strictEqual(rows.length, 1, "two wrong answers is an ordinary afternoon");
  assert.strictEqual(rows[0].name, "Ada");
  assert.match(
    rows[0].reasons.find((r) => r.code === ATTENTION_REASON.REPEATED_INCORRECT).label,
    /3 incorrect attempts in Loops/
  );
});

test("an unresolved misconception is reported by its label, never its type id", async (t) => {
  stubCourse(t, {
    learners: [learner("s1", "Ada")],
    gaps: [gap("s1")]
  });

  const { learners: rows } = await attention();
  const reason = rows[0].reasons.find((r) => r.code === ATTENTION_REASON.MISCONCEPTION_OPEN);

  assert.match(reason.label, /Terminology Confusion/);
  assert.ok(!reason.label.includes("TERMINOLOGY_CONFUSION"), "the identifier stays internal");
});

test("a resolved misconception is not a reason", async (t) => {
  stubCourse(t, {
    learners: [learner("s1", "Ada")],
    gaps: [gap("s1", { status: "CLOSED" })]
  });

  assert.deepStrictEqual((await attention()).learners, []);
});

test("repeated qualifying failures and an exhausted allowance read differently", async (t) => {
  stubCourse(t, {
    learners: [learner("s1", "Ada"), learner("s2", "Grace")],
    qualifying: [
      qualifyingRow("s1", { attemptCount: 2, passed: false }),
      qualifyingRow("s2", { attemptCount: 3, passed: false })
    ]
  });

  const { learners: rows } = await attention();
  const ada = rows.find((r) => r.name === "Ada");
  const grace = rows.find((r) => r.name === "Grace");

  assert.ok(ada.reasons.some((r) => r.code === ATTENTION_REASON.QUALIFYING_FAILED));
  assert.ok(
    grace.reasons.some((r) => r.code === ATTENTION_REASON.QUALIFYING_EXHAUSTED),
    "3 of 3 used is exhausted, not merely failed"
  );
});

test("a learner who passed the qualifying test is not flagged for it", async (t) => {
  stubCourse(t, {
    learners: [learner("s1", "Ada")],
    qualifying: [qualifyingRow("s1", { attemptCount: 3, passed: true, passedOnAttempt: 3 })]
  });

  assert.deepStrictEqual((await attention()).learners, []);
});

test("a stalled learner is flagged with how long it has been", async (t) => {
  stubCourse(t, {
    learners: [
      learner("s1", "Ada", { lastAccessedAt: daysBefore(ATTENTION_CONFIG.STALLED_DAYS + 6) })
    ]
  });

  const reason = (await attention()).learners[0].reasons.find(
    (r) => r.code === ATTENTION_REASON.STALLED
  );

  assert.match(reason.label, /No activity for 20 days/);
});

test("a finished learner is never 'stalled'", async (t) => {
  stubCourse(t, {
    learners: [learner("s1", "Ada", { completed: true, progressPercent: 100, lastAccessedAt: daysBefore(90) })]
  });

  assert.deepStrictEqual((await attention()).learners, []);
});

test("one learner can carry several reasons at once, and sorts to the top", async (t) => {
  stubCourse(t, {
    learners: [
      learner("s1", "Ada", { lastAccessedAt: daysBefore(30) }),
      learner("s2", "Grace")
    ],
    signalRows: [
      signalRow("s1", "Recursion", { delayedAnswered: 3, delayedCorrect: 0 }),
      signalRow("s2", "Loops", { answered: 5, correct: 2, delayedAnswered: 0, delayedCorrect: 0 })
    ],
    gaps: [gap("s1")]
  });

  const { learners: rows } = await attention();

  assert.strictEqual(rows[0].name, "Ada");
  assert.ok(rows[0].reasons.length >= 3, "decayed retention, misconception and stalled");
  const codes = rows[0].reasons.map((r) => r.code);
  assert.ok(codes.includes(ATTENTION_REASON.RETENTION_DECAYED));
  assert.ok(codes.includes(ATTENTION_REASON.MISCONCEPTION_OPEN));
  assert.ok(codes.includes(ATTENTION_REASON.STALLED));
});

test("weak transfer is not reported on top of decayed retention for the same concept", async (t) => {
  // Two reasons for one underlying thing is noise on a triage list.
  stubCourse(t, {
    learners: [learner("s1", "Ada")],
    signalRows: [
      signalRow("s1", "Recursion", {
        delayedAnswered: 3,
        delayedCorrect: 0,
        distinctCorrectQuestions: 1,
        distinctCorrectQuizzes: 1
      }),
      signalRow("s1", "Loops", {
        delayedAnswered: 3,
        delayedCorrect: 0,
        distinctCorrectQuestions: 1,
        distinctCorrectQuizzes: 1
      })
    ]
  });

  const codes = (await attention()).learners[0].reasons.map((r) => r.code);

  assert.ok(codes.includes(ATTENTION_REASON.RETENTION_DECAYED));
  assert.ok(!codes.includes(ATTENTION_REASON.WEAK_TRANSFER));
});

test("the learner list paginates and reports the true total", async (t) => {
  const many = Array.from({ length: 7 }, (_, i) => learner(`s${i}`, `Learner ${i}`));
  stubCourse(t, {
    learners: many,
    signalRows: many.map((l) => signalRow(l.studentId, "Recursion", { delayedAnswered: 3, delayedCorrect: 0 }))
  });

  const page = await attention(INSTRUCTOR, { limit: 3, offset: 3 });

  assert.strictEqual(page.learners.length, 3);
  assert.strictEqual(page.total, 7, "the total is the whole list, not the page");
  assert.strictEqual(page.offset, 3);
});

test("an absurd page size is clamped rather than honoured", async (t) => {
  stubCourse(t, { learners: [learner("s1", "Ada")] });

  const page = await attention(INSTRUCTOR, { limit: 100000 });

  assert.strictEqual(page.limit, ATTENTION_CONFIG.MAX_PAGE_SIZE);
});

// ---------------------------------------------------------------------------
// Concept, retention and misconception aggregation
// ---------------------------------------------------------------------------

test("concept insights count learners, not attempts", async (t) => {
  stubCourse(t, {
    learners: [learner("s1", "Ada"), learner("s2", "Grace"), learner("s3", "Alan")],
    signalRows: [
      signalRow("s1", "Recursion", { delayedAnswered: 3, delayedCorrect: 0 }),
      signalRow("s2", "Recursion", { delayedAnswered: 3, delayedCorrect: 0 }),
      signalRow("s3", "Recursion", { delayedAnswered: 3, delayedCorrect: 3 })
    ]
  });

  const [concept] = (await overview()).concepts;

  assert.strictEqual(concept.concept, "Recursion");
  assert.strictEqual(concept.learners, 3);
  assert.strictEqual(concept.learnersStruggling, 2);
  assert.strictEqual(concept.retention.DECAYED, 2);
  assert.strictEqual(concept.retention.RETAINED, 1);
});

test("the concept most learners are struggling with leads", async (t) => {
  stubCourse(t, {
    learners: [learner("s1", "Ada"), learner("s2", "Grace")],
    signalRows: [
      signalRow("s1", "Fine Thing", { delayedAnswered: 3, delayedCorrect: 3 }),
      signalRow("s1", "Hard Thing", { delayedAnswered: 3, delayedCorrect: 0 }),
      signalRow("s2", "Hard Thing", { delayedAnswered: 3, delayedCorrect: 0 })
    ]
  });

  const { concepts } = await overview();

  assert.strictEqual(concepts[0].concept, "Hard Thing");
});

test("retention totals reuse the Phase 8 statuses verbatim", async (t) => {
  // Invariant 1: the instructor's count and the student's label are the same
  // judgement, counted twice — not two definitions that can drift.
  stubCourse(t, {
    learners: [learner("s1", "Ada")],
    signalRows: [
      signalRow("s1", "A", { delayedAnswered: 3, delayedCorrect: 3 }),
      signalRow("s1", "B", { delayedAnswered: 4, delayedCorrect: 2 }),
      signalRow("s1", "C", { delayedAnswered: 3, delayedCorrect: 0 }),
      signalRow("s1", "D", { delayedAnswered: 0, delayedCorrect: 0 })
    ]
  });

  assert.deepStrictEqual((await overview()).retention, {
    RETAINED: 1, SHAKY: 1, DECAYED: 1, INSUFFICIENT_EVIDENCE: 1
  });
});

test("misconceptions roll up by label with affected and unresolved counts", async (t) => {
  stubCourse(t, {
    learners: [learner("s1", "Ada"), learner("s2", "Grace")],
    gaps: [gap("s1"), gap("s2", { status: "CLOSED" })]
  });

  const [row] = (await overview()).misconceptions;

  assert.strictEqual(row.label, "Terminology Confusion");
  assert.strictEqual(row.learnersAffected, 2);
  assert.strictEqual(row.learnersUnresolved, 1);
  assert.deepStrictEqual(row.concepts, ["Inheritance"]);
});

test("a gap with no taxonomy type is described, not labelled with a blank", async (t) => {
  stubCourse(t, {
    learners: [learner("s1", "Ada")],
    gaps: [gap("s1", { type: null, concept: "Pointers", kc: "Pointers" })]
  });

  const [row] = (await overview()).misconceptions;

  assert.strictEqual(row.label, "Difficulty with Pointers");
});

test("qualifying insights report pass rate and average attempts to qualify", async (t) => {
  stubCourse(t, {
    learners: [learner("s1", "Ada"), learner("s2", "Grace"), learner("s3", "Alan")],
    qualifying: [
      qualifyingRow("s1", { attemptCount: 1, passed: true, passedOnAttempt: 1 }),
      qualifyingRow("s2", { attemptCount: 3, passed: true, passedOnAttempt: 3 }),
      qualifyingRow("s3", { attemptCount: 1, passed: false })
    ]
  });

  const [quiz] = (await overview()).qualifyingTests;

  assert.strictEqual(quiz.learnersAttempted, 3);
  assert.strictEqual(quiz.learnersPassed, 2);
  assert.strictEqual(quiz.passRate, 67);
  assert.strictEqual(quiz.averageAttemptsToQualify, 2, "counted over those who qualified only");
  assert.strictEqual(quiz.targetTitle, "Classes and Objects");
});

test("the overview never carries an answer key or a database id", async (t) => {
  stubCourse(t, {
    learners: [learner("s1", "Ada")],
    signalRows: [signalRow("s1", "Recursion", { delayedAnswered: 3, delayedCorrect: 0 })],
    gaps: [gap("s1")],
    qualifying: [qualifyingRow("s1")]
  });

  const json = JSON.stringify(await overview());

  assert.ok(!json.includes("correctAnswer"));
  assert.ok(!json.includes("qq-1"), "quiz ids stay server-side in the overview");
  assert.ok(!json.includes("TERMINOLOGY_CONFUSION"));
});

test("the intervention summary counts what the engine is actually doing", async (t) => {
  stubCourse(t, {
    learners: [learner("s1", "Ada"), learner("s2", "Grace")],
    signalRows: [
      signalRow("s1", "Recursion", { delayedAnswered: 3, delayedCorrect: 0 }),
      signalRow("s2", "Recursion", { delayedAnswered: 3, delayedCorrect: 0 })
    ]
  });

  const { interventions, summary } = await overview();

  assert.strictEqual(interventions[ATTENTION_REASON.RETENTION_DECAYED], 2);
  assert.strictEqual(summary.learnersNeedingAttention, 2, "the headline matches the list");
});

test("learners showing improvement are counted from earned evidence", async (t) => {
  stubCourse(t, {
    learners: [learner("s1", "Ada"), learner("s2", "Grace")],
    signalRows: [
      signalRow("s1", "Recursion", { delayedAnswered: 3, delayedCorrect: 3 }),
      signalRow("s2", "Recursion", { delayedAnswered: 3, delayedCorrect: 0, distinctCorrectQuizzes: 1 })
    ]
  });

  assert.strictEqual((await overview()).summary.learnersShowingImprovement, 1);
});

// ---------------------------------------------------------------------------
// Drill-down
// ---------------------------------------------------------------------------

function stubDrilldown(t, { path = [], recommendations = [], nextAction = null, gaps = [], signalRows = [] }) {
  const originals = {
    enrollmentFindUnique: prisma.enrollment.findUnique,
    gapFindMany: prisma.knowledgeGap.findMany,
    learningPath: progressService.getStudentLearningPath,
    recs: recommendationService.getRecommendations,
    next: nextActionService.getNextAction
  };

  t.after(() => {
    prisma.enrollment.findUnique = originals.enrollmentFindUnique;
    prisma.knowledgeGap.findMany = originals.gapFindMany;
    progressService.getStudentLearningPath = originals.learningPath;
    recommendationService.getRecommendations = originals.recs;
    nextActionService.getNextAction = originals.next;
  });

  prisma.enrollment.findUnique = async () => ({
    progressPercent: 55,
    completed: false,
    lastAccessedAt: daysBefore(2),
    enrolledAt: daysBefore(40),
    student: { id: "s1", user: { name: "Ada", email: "ada@example.com" } }
  });
  prisma.knowledgeGap.findMany = async () => gaps;
  progressService.getStudentLearningPath = async () => path;
  recommendationService.getRecommendations = async () => ({
    recommendations,
    weakAreas: [{ concept: "Recursion", masteryLabel: "Needs practice" }],
    masteryOverview: []
  });
  nextActionService.getNextAction = async () =>
    nextAction || {
      primary: { action: "CONTINUE_LEARNING", headline: "Continue Learning", title: "Recursion", reason: "Continue where you left off." },
      secondary: [],
      qualifiedCount: 0
    };
}

test("the drill-down reuses the existing learning path, not a second one", async (t) => {
  stubCourse(t, { learners: [], signalRows: [signalRow("s1", "Recursion", { delayedAnswered: 3, delayedCorrect: 0 })] });
  stubDrilldown(t, {
    path: [
      { kind: "TOPIC", title: "Variables", status: "COMPLETED", qualified: false },
      { kind: "TOPIC", title: "Recursion", status: "CURRENT", qualified: false },
      { kind: "TOPIC", title: "Generics", status: "LOCKED", qualified: false },
      { kind: "LESSON", title: "Skipped Lesson", status: "QUALIFIED", qualified: true }
    ]
  });

  const result = await insights.getLearnerDetail(INSTRUCTOR, {
    courseId: COURSE, studentId: "s1", now: NOW
  });

  assert.strictEqual(result.position.current, "Recursion");
  assert.strictEqual(result.position.completed, 1);
  assert.strictEqual(result.position.locked, 1);
  assert.strictEqual(result.position.qualified, 1, "qualified is reported apart from completed");
  assert.strictEqual(result.position.total, 4);
});

test("the drill-down shows what the engine is telling the learner", async (t) => {
  stubCourse(t, { learners: [], signalRows: [] });
  stubDrilldown(t, {
    path: [],
    recommendations: [
      { title: "Review Recursion", reason: "You missed 3 questions on this topic.", priority: "HIGH", id: "concept:Recursion" }
    ]
  });

  const result = await insights.getLearnerDetail(INSTRUCTOR, {
    courseId: COURSE, studentId: "s1", now: NOW
  });

  assert.strictEqual(result.adaptive.nextAction.title, "Recursion");
  assert.strictEqual(result.adaptive.recommendations[0].title, "Review Recursion");
  assert.deepStrictEqual(result.weakAreas, [{ concept: "Recursion", masteryLabel: "Needs practice" }]);
});

test("the drill-down classifies signals with the Phase 8 evaluators", async (t) => {
  stubCourse(t, { learners: [], signalRows: [signalRow("s1", "Recursion", { delayedAnswered: 3, delayedCorrect: 0 })] });
  stubDrilldown(t, { path: [] });

  const result = await insights.getLearnerDetail(INSTRUCTOR, {
    courseId: COURSE, studentId: "s1", now: NOW
  });

  assert.strictEqual(result.signals[0].concept, "Recursion");
  assert.strictEqual(result.signals[0].retention.status, "DECAYED");
  assert.ok(result.reasons.some((r) => r.code === ATTENTION_REASON.RETENTION_DECAYED));
});

test("the drill-down exposes no model internals or raw identifiers", async (t) => {
  stubCourse(t, { learners: [], signalRows: [signalRow("s1", "Recursion", { delayedAnswered: 3, delayedCorrect: 0 })] });
  stubDrilldown(t, { path: [], gaps: [gap("s1")] });

  const json = JSON.stringify(
    await insights.getLearnerDetail(INSTRUCTOR, { courseId: COURSE, studentId: "s1", now: NOW })
  );

  assert.ok(!json.includes("masteryScore"));
  assert.ok(!json.includes("masteryProbability"));
  assert.ok(!json.includes("correctAnswer"));
  assert.ok(!json.includes("TERMINOLOGY_CONFUSION"), "labels only, never the type id");
});

// ---------------------------------------------------------------------------
// Performance shape
// ---------------------------------------------------------------------------

test("a cohort is read with a fixed number of queries, not one per learner", async (t) => {
  // Invariant 5. The guard that matters at a thousand learners: this must not
  // become a loop of per-student lookups.
  const many = Array.from({ length: 50 }, (_, i) => learner(`s${i}`, `Learner ${i}`));

  let signalCalls = 0;
  let rawCalls = 0;
  let enrollmentCalls = 0;

  stubCourse(t, { learners: many });

  const stubbedSignals = retentionService.fetchSignalRows;
  const stubbedRaw = prisma.$queryRaw;
  const stubbedEnrollments = prisma.enrollment.findMany;

  retentionService.fetchSignalRows = async (...args) => {
    signalCalls += 1;
    return stubbedSignals(...args);
  };
  prisma.$queryRaw = async (...args) => {
    rawCalls += 1;
    return stubbedRaw(...args);
  };
  prisma.enrollment.findMany = async (...args) => {
    enrollmentCalls += 1;
    return stubbedEnrollments(...args);
  };

  await overview();

  assert.strictEqual(enrollmentCalls, 1, "one enrolment read for the whole cohort");
  assert.strictEqual(signalCalls, 1, "one aggregated signal query");
  assert.strictEqual(rawCalls, 2, "one misconception join, one qualifying join");
});
