const prisma = require("../../config/database");
// Required as modules, not destructured, so both stay stubbable — the same
// reason nextAction.service requires recommendation.service this way.
const retentionService = require("./retention.service");
const recommendationService = require("./recommendation.service");
const nextActionService = require("./nextAction.service");
const progressService = require("../progress/progress.service");
const { RETENTION_STATUS, TRANSFER_STATUS } = require("./retention.config");
const { MISCONCEPTION_TAXONOMY } = require("./misconceptionTaxonomy.config");
const { QUALIFYING_TAG } = require("../../utils/qualification");
const { effectiveMaxAttempts } = require("../../utils/attemptAllowance");
const { ATTENTION_CONFIG, ATTENTION_REASON } = require("./instructorInsights.config");

/**
 * Phase 9 — instructor-facing analytics over the existing adaptive system.
 *
 * Strictly observational. Nothing in this file decides anything: it reads the
 * evidence Phases 1–8 already record, applies the Phase 8 evaluators that
 * already exist, and counts the results. It cannot unlock content, grant an
 * attempt, change a recommendation or alter a next action, and there is no
 * way for an instructor to reach the deterministic engine through it.
 *
 * Misconception labels that originated from the LLM-assisted classifier are
 * carried here as EVIDENCE ONLY, already constrained to the fixed taxonomy,
 * and are rendered through MISCONCEPTION_TAXONOMY's human-readable labels —
 * never raw model output, never an internal identifier.
 */

/**
 * The course this caller is allowed to analyse, or a 404.
 *
 * Follows quizAnalytics.buildQuizScope rather than
 * progress.assertCourseProgressAccess: the ownership test is folded INTO the
 * lookup, so a course that does not exist and a course belonging to another
 * instructor are indistinguishable from the outside. The alternative — 404
 * for missing, 403 for not-yours — tells an instructor which course ids are
 * real, one probe at a time.
 *
 * ADMIN skips the ownership clause, matching every other analytics surface.
 */
const assertInstructorCourseAccess = async (callingUser, courseId) => {
  if (!courseId) {
    const error = new Error("courseId is required");
    error.statusCode = 400;
    throw error;
  }

  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      ...(callingUser?.role === "ADMIN" ? {} : { creatorId: callingUser?.id ?? "__none__" })
    },
    select: { id: true, title: true }
  });

  if (!course) {
    const error = new Error("Course not found");
    error.statusCode = 404;
    throw error;
  }

  return course;
};

/**
 * The learners enrolled on the course, with the names to display.
 *
 * One query. Every later step keys off this map rather than asking the
 * database about a student again.
 */
const fetchEnrolledLearners = async (courseId) => {
  const enrollments = await prisma.enrollment.findMany({
    where: { courseId },
    select: {
      studentId: true,
      progressPercent: true,
      completed: true,
      lastAccessedAt: true,
      enrolledAt: true,
      student: { select: { id: true, user: { select: { name: true, email: true } } } }
    }
  });

  return enrollments.map((row) => ({
    studentId: row.studentId,
    name: row.student?.user?.name || "Unnamed learner",
    email: row.student?.user?.email || null,
    progressPercent: row.progressPercent ?? 0,
    completed: row.completed === true,
    lastAccessedAt: row.lastAccessedAt ?? null,
    enrolledAt: row.enrolledAt ?? null
  }));
};

/**
 * Open misconceptions for this course's learners, aggregated in SQL.
 *
 * KnowledgeGap carries no courseId, so the scope comes from a join to
 * Enrollment rather than from an IN list of student ids — which would be a
 * query the size of the cohort.
 */
const fetchMisconceptionRows = async (courseId) => {
  const rows = await prisma.$queryRaw`
    SELECT g."studentId"  AS "studentId",
           g."concept"    AS "concept",
           g."kc"         AS "kc",
           g."type"       AS "type",
           g."status"     AS "status",
           g."severity"   AS "severity"
      FROM "KnowledgeGap" g
      JOIN "Enrollment"   e ON e."studentId" = g."studentId"
     WHERE e."courseId" = ${courseId}
  `;

  return rows.map((row) => ({ ...row, severity: Number(row.severity ?? 0) }));
};

/**
 * Qualifying-test outcomes per quiz, aggregated in SQL.
 *
 * Counts only. No question, option or answer ever leaves this query, so the
 * qualifying-test answer-key rules are not merely respected — there is
 * nothing here that could breach them.
 */
const fetchQualifyingRows = async (courseId) => {
  const rows = await prisma.$queryRaw`
    SELECT z."id"                                          AS "quizId",
           z."title"                                       AS "quizTitle",
           z."attempts"                                    AS "allowance",
           l."title"                                       AS "lessonTitle",
           t."title"                                       AS "topicTitle",
           a."studentId"                                   AS "studentId",
           COUNT(*)                                        AS "attemptCount",
           BOOL_OR(a."passed")                             AS "passed",
           MIN(a."attemptNumber") FILTER (WHERE a."passed") AS "passedOnAttempt"
      FROM "QuizAttempt" a
      JOIN "Quiz"        z ON z."id" = a."quizId"
      LEFT JOIN "Lesson" l ON l."id" = z."lessonId"
      LEFT JOIN "Topic"  t ON t."id" = z."topicId"
     WHERE z."courseId" = ${courseId}
       AND z."quizTag"::text = ${QUALIFYING_TAG}
     GROUP BY z."id", z."title", z."attempts", l."title", t."title", a."studentId"
  `;

  return rows.map((row) => ({
    quizId: row.quizId,
    quizTitle: row.quizTitle,
    allowance: row.allowance,
    lessonTitle: row.lessonTitle ?? null,
    topicTitle: row.topicTitle ?? null,
    studentId: row.studentId,
    attemptCount: Number(row.attemptCount),
    passed: row.passed === true,
    passedOnAttempt: row.passedOnAttempt === null ? null : Number(row.passedOnAttempt)
  }));
};

/** A human-readable name for a misconception, never its identifier. */
const misconceptionLabel = (row) => {
  const entry = row.type ? MISCONCEPTION_TAXONOMY[row.type] : null;
  if (entry) return entry.label;
  // A gap recorded before the taxonomy existed carries only the concept it
  // was detected on. Reported as such rather than dressed up as a type.
  return row.concept ? `Difficulty with ${row.concept}` : "Unclassified difficulty";
};

/** Empty counters, so a course with no evidence reports zeros in a known shape. */
const emptyRetentionCounts = () => ({
  RETAINED: 0,
  SHAKY: 0,
  DECAYED: 0,
  INSUFFICIENT_EVIDENCE: 0
});

/**
 * Per-concept rollup across every learner.
 *
 * Built from the signal grid, which is already one row per learner per
 * concept — the individual attempts stay in Postgres.
 */
const buildConceptInsights = (signals, misconceptions) => {
  const byConcept = new Map();

  const ensure = (concept) => {
    if (!byConcept.has(concept)) {
      byConcept.set(concept, {
        concept,
        learners: new Set(),
        learnersStruggling: new Set(),
        questionsAnswered: 0,
        incorrect: 0,
        retention: emptyRetentionCounts(),
        transfer: { TRANSFERRED: 0, REPEATED_ONLY: 0, NOT_DEMONSTRATED: 0, INSUFFICIENT_EVIDENCE: 0 },
        misconceptionLearners: new Set()
      });
    }
    return byConcept.get(concept);
  };

  for (const signal of signals) {
    const entry = ensure(signal.concept);
    entry.learners.add(signal.studentId);
    entry.questionsAnswered += signal.evidence.questionsAnswered;
    entry.incorrect += signal.evidence.incorrect;
    entry.retention[signal.retention.status] += 1;
    entry.transfer[signal.transfer.status] += 1;

    if (
      signal.retention.status === RETENTION_STATUS.DECAYED ||
      signal.retention.status === RETENTION_STATUS.SHAKY ||
      signal.evidence.incorrect >= ATTENTION_CONFIG.REPEATED_INCORRECT
    ) {
      entry.learnersStruggling.add(signal.studentId);
    }
  }

  // Misconceptions attach to a concept where one is named, so a concept the
  // student has never been quizzed on can still appear if a gap points at it.
  for (const row of misconceptions) {
    if (row.status !== "OPEN") continue;
    const concept = (row.kc || row.concept || "").trim();
    if (!concept) continue;
    const entry = ensure(concept);
    entry.misconceptionLearners.add(row.studentId);
    entry.learners.add(row.studentId);
  }

  const insights = [...byConcept.values()].map((entry) => ({
    concept: entry.concept,
    learners: entry.learners.size,
    learnersStruggling: entry.learnersStruggling.size,
    questionsAnswered: entry.questionsAnswered,
    incorrect: entry.incorrect,
    retention: entry.retention,
    transfer: entry.transfer,
    learnersWithMisconception: entry.misconceptionLearners.size
  }));

  // Most learners struggling first; ties broken by raw incorrect answers, then
  // name, so the order is total and never depends on row order.
  insights.sort(
    (a, b) =>
      b.learnersStruggling - a.learnersStruggling ||
      b.incorrect - a.incorrect ||
      a.concept.localeCompare(b.concept)
  );

  return insights;
};

/**
 * Why a learner might want the instructor's attention — as a LIST of plain
 * reasons, never a single opaque score.
 *
 * §3 of the brief is explicit about this, and it is the right call: "at risk,
 * 0.72" tells an instructor nothing they can act on, and invites them to
 * trust a number whose derivation they cannot see. Every reason below names
 * the evidence that produced it and can be checked against the learner's own
 * history.
 *
 * A learner can carry several. They are not weighted against each other and
 * are not summed.
 */
const buildAttentionReasons = ({ learner, signals, misconceptions, qualifying, now }) => {
  const reasons = [];

  const decayed = signals.filter((s) => s.retention.status === RETENTION_STATUS.DECAYED);
  if (decayed.length > 0) {
    reasons.push({
      code: ATTENTION_REASON.RETENTION_DECAYED,
      label: decayed.length === 1
        ? `Retention needs review in ${decayed[0].concept}`
        : `Retention needs review in ${decayed.length} concepts`,
      concepts: decayed.map((s) => s.concept)
    });
  }

  const repeated = signals.filter(
    (s) => s.evidence.incorrect >= ATTENTION_CONFIG.REPEATED_INCORRECT
  );
  if (repeated.length > 0) {
    const worst = repeated.reduce((a, b) => (b.evidence.incorrect > a.evidence.incorrect ? b : a));
    reasons.push({
      code: ATTENTION_REASON.REPEATED_INCORRECT,
      label: `${worst.evidence.incorrect} incorrect attempts in ${worst.concept}`,
      concepts: repeated.map((s) => s.concept)
    });
  }

  const openGaps = misconceptions.filter((m) => m.status === "OPEN");
  if (openGaps.length > 0) {
    const first = openGaps[0];
    reasons.push({
      code: ATTENTION_REASON.MISCONCEPTION_OPEN,
      label:
        openGaps.length === 1
          ? `${misconceptionLabel(first)} — unresolved`
          : `${openGaps.length} unresolved misconceptions`,
      concepts: [...new Set(openGaps.map((m) => (m.kc || m.concept || "").trim()).filter(Boolean))]
    });
  }

  // Weak transfer only counts where retention is NOT already the story —
  // otherwise one learner shows two reasons for the same underlying thing.
  const weakTransfer = signals.filter(
    (s) =>
      s.transfer.status === TRANSFER_STATUS.REPEATED_ONLY &&
      s.retention.status !== RETENTION_STATUS.DECAYED
  );
  if (weakTransfer.length >= ATTENTION_CONFIG.WEAK_TRANSFER_CONCEPTS) {
    reasons.push({
      code: ATTENTION_REASON.WEAK_TRANSFER,
      label: `Answers only correct in familiar questions (${weakTransfer.length} concepts)`,
      concepts: weakTransfer.map((s) => s.concept)
    });
  }

  for (const attempt of qualifying) {
    if (attempt.passed) continue;
    const limit = effectiveMaxAttempts({ quizTag: QUALIFYING_TAG, attempts: attempt.allowance });
    const exhausted = Number(limit) > 0 && attempt.attemptCount >= limit;

    if (exhausted) {
      reasons.push({
        code: ATTENTION_REASON.QUALIFYING_EXHAUSTED,
        label: `Qualifying test attempts exhausted (${attempt.quizTitle})`,
        concepts: []
      });
    } else if (attempt.attemptCount >= ATTENTION_CONFIG.QUALIFYING_FAILURES) {
      reasons.push({
        code: ATTENTION_REASON.QUALIFYING_FAILED,
        label: `Qualifying test failed ${attempt.attemptCount} times (${attempt.quizTitle})`,
        concepts: []
      });
    }
  }

  // Stalled: enrolled, started, not finished, and nothing since. Read from
  // Enrollment, which the platform already maintains — no per-learner path
  // computation, which would be a query per student.
  if (!learner.completed && learner.lastAccessedAt) {
    const days = Math.floor((now.getTime() - new Date(learner.lastAccessedAt).getTime()) / 86_400_000);
    if (days >= ATTENTION_CONFIG.STALLED_DAYS) {
      reasons.push({
        code: ATTENTION_REASON.STALLED,
        label: `No activity for ${days} days (${learner.progressPercent}% complete)`,
        concepts: []
      });
    }
  }

  return reasons;
};

/** Groups a flat list by a key, into a Map of arrays. */
const groupBy = (rows, keyOf) => {
  const map = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
};

/**
 * Qualifying-test outcomes per quiz, for the overview.
 *
 * "Average attempts to qualify" counts ONLY the learners who eventually
 * passed. Including those still trying would drag the figure toward whoever
 * has failed most recently and make it read as worse than it is.
 */
const buildQualifyingInsights = (rows) => {
  const byQuiz = groupBy(rows, (row) => row.quizId);

  const insights = [...byQuiz.entries()].map(([quizId, attempts]) => {
    const limit = effectiveMaxAttempts({
      quizTag: QUALIFYING_TAG,
      attempts: attempts[0].allowance
    });
    const unlimited = !(Number(limit) > 0);

    const passedLearners = attempts.filter((a) => a.passed);
    const failing = attempts.filter((a) => !a.passed);
    const exhausted = failing.filter((a) => !unlimited && a.attemptCount >= limit);

    const attemptsToQualify = passedLearners
      .map((a) => a.passedOnAttempt)
      .filter((n) => typeof n === "number");

    return {
      quizTitle: attempts[0].quizTitle,
      targetTitle: attempts[0].topicTitle || attempts[0].lessonTitle || null,
      learnersAttempted: attempts.length,
      learnersPassed: passedLearners.length,
      learnersFailed: failing.length,
      learnersStillTrying: failing.length - exhausted.length,
      learnersExhausted: exhausted.length,
      passRate: attempts.length === 0 ? null : Math.round((passedLearners.length / attempts.length) * 100),
      // Null, not 0, when nobody has qualified yet — "no one has passed" and
      // "everyone passed first time" must not render as the same thing.
      averageAttemptsToQualify:
        attemptsToQualify.length === 0
          ? null
          : Number(
              (attemptsToQualify.reduce((sum, n) => sum + n, 0) / attemptsToQualify.length).toFixed(1)
            )
    };
  });

  insights.sort(
    (a, b) => (a.passRate ?? 101) - (b.passRate ?? 101) || a.quizTitle.localeCompare(b.quizTitle)
  );

  return insights;
};

/** Misconceptions rolled up by label, for the overview. */
const buildMisconceptionInsights = (rows) => {
  const byLabel = new Map();

  for (const row of rows) {
    const label = misconceptionLabel(row);
    if (!byLabel.has(label)) {
      byLabel.set(label, {
        label,
        concepts: new Set(),
        learners: new Set(),
        unresolvedLearners: new Set()
      });
    }
    const entry = byLabel.get(label);
    const concept = (row.kc || row.concept || "").trim();
    if (concept) entry.concepts.add(concept);
    entry.learners.add(row.studentId);
    if (row.status === "OPEN") entry.unresolvedLearners.add(row.studentId);
  }

  const insights = [...byLabel.values()].map((entry) => ({
    label: entry.label,
    concepts: [...entry.concepts].sort(),
    learnersAffected: entry.learners.size,
    learnersUnresolved: entry.unresolvedLearners.size
  }));

  insights.sort(
    (a, b) =>
      b.learnersUnresolved - a.learnersUnresolved ||
      b.learnersAffected - a.learnersAffected ||
      a.label.localeCompare(b.label)
  );

  return insights;
};

/**
 * The course-level adaptive overview.
 *
 * Four aggregated queries, regardless of how many learners are enrolled: the
 * enrolment list, the signal grid, the misconception join and the qualifying
 * join. No per-learner round trip anywhere.
 */
const getCourseInsights = async (callingUser, { courseId, now = new Date() } = {}) => {
  const course = await assertInstructorCourseAccess(callingUser, courseId);

  const [learners, signals, misconceptions, qualifying] = await Promise.all([
    fetchEnrolledLearners(courseId),
    retentionService.getCourseLearningSignals(courseId, { now }),
    fetchMisconceptionRows(courseId),
    fetchQualifyingRows(courseId)
  ]);

  const signalsByStudent = groupBy(signals, (s) => s.studentId);
  const misconceptionsByStudent = groupBy(misconceptions, (m) => m.studentId);
  const qualifyingByStudent = groupBy(qualifying, (q) => q.studentId);

  const retentionTotals = emptyRetentionCounts();
  for (const signal of signals) retentionTotals[signal.retention.status] += 1;

  // How many learners carry at least one reason. Computed from the same
  // builder the learners list uses, so the headline count can never disagree
  // with the list the instructor then opens.
  let learnersNeedingAttention = 0;
  const reasonTotals = {};
  for (const learner of learners) {
    const reasons = buildAttentionReasons({
      learner,
      signals: signalsByStudent.get(learner.studentId) || [],
      misconceptions: misconceptionsByStudent.get(learner.studentId) || [],
      qualifying: qualifyingByStudent.get(learner.studentId) || [],
      now
    });
    if (reasons.length > 0) learnersNeedingAttention += 1;
    for (const reason of reasons) {
      reasonTotals[reason.code] = (reasonTotals[reason.code] ?? 0) + 1;
    }
  }

  const conceptInsights = buildConceptInsights(signals, misconceptions);

  // Learners who have demonstrated durable understanding somewhere — the one
  // positive signal on the page, and it is earned, not a participation count.
  const improving = new Set(
    signals
      .filter(
        (s) =>
          s.retention.status === RETENTION_STATUS.RETAINED ||
          s.transfer.status === TRANSFER_STATUS.TRANSFERRED
      )
      .map((s) => s.studentId)
  );

  return {
    course: { title: course.title },
    summary: {
      learnersEnrolled: learners.length,
      learnersWithEvidence: signalsByStudent.size,
      learnersNeedingAttention,
      learnersShowingImprovement: improving.size,
      averageProgressPercent:
        learners.length === 0
          ? null
          : Math.round(learners.reduce((sum, l) => sum + l.progressPercent, 0) / learners.length)
    },
    retention: retentionTotals,
    concepts: conceptInsights.slice(0, ATTENTION_CONFIG.MAX_CONCEPTS),
    misconceptions: buildMisconceptionInsights(misconceptions).slice(
      0,
      ATTENTION_CONFIG.MAX_MISCONCEPTIONS
    ),
    qualifyingTests: buildQualifyingInsights(qualifying),
    interventions: reasonTotals
  };
};

/**
 * Learners who may need attention, newest concern first, paginated.
 *
 * Same four aggregated queries as the overview. Pagination is applied after
 * the reasons are built because the ordering depends on them, but nothing
 * per-learner touches the database.
 */
const getLearnersNeedingAttention = async (
  callingUser,
  { courseId, limit = ATTENTION_CONFIG.DEFAULT_PAGE_SIZE, offset = 0, now = new Date() } = {}
) => {
  await assertInstructorCourseAccess(callingUser, courseId);

  const safeLimit = Math.min(
    Math.max(Number(limit) || ATTENTION_CONFIG.DEFAULT_PAGE_SIZE, 1),
    ATTENTION_CONFIG.MAX_PAGE_SIZE
  );
  const safeOffset = Math.max(Number(offset) || 0, 0);

  const [learners, signals, misconceptions, qualifying] = await Promise.all([
    fetchEnrolledLearners(courseId),
    retentionService.getCourseLearningSignals(courseId, { now }),
    fetchMisconceptionRows(courseId),
    fetchQualifyingRows(courseId)
  ]);

  const signalsByStudent = groupBy(signals, (s) => s.studentId);
  const misconceptionsByStudent = groupBy(misconceptions, (m) => m.studentId);
  const qualifyingByStudent = groupBy(qualifying, (q) => q.studentId);

  const rows = learners
    .map((learner) => ({
      studentId: learner.studentId,
      name: learner.name,
      email: learner.email,
      progressPercent: learner.progressPercent,
      lastAccessedAt: learner.lastAccessedAt,
      reasons: buildAttentionReasons({
        learner,
        signals: signalsByStudent.get(learner.studentId) || [],
        misconceptions: misconceptionsByStudent.get(learner.studentId) || [],
        qualifying: qualifyingByStudent.get(learner.studentId) || [],
        now
      })
    }))
    .filter((row) => row.reasons.length > 0);

  // Most reasons first, then least progress, then name — total, and
  // independent of the order the database returned enrolments in.
  rows.sort(
    (a, b) =>
      b.reasons.length - a.reasons.length ||
      a.progressPercent - b.progressPercent ||
      a.name.localeCompare(b.name)
  );

  return {
    learners: rows.slice(safeOffset, safeOffset + safeLimit),
    total: rows.length,
    limit: safeLimit,
    offset: safeOffset
  };
};

/**
 * One learner's adaptive state, for the drill-down.
 *
 * Every section is the EXISTING representation, read through the existing
 * service: the learning path the player enforces, the progress roll-up the
 * student sees, the Phase 8 signals, and the same recommendations and next
 * action the student is being given. There is no second model of a learner
 * here — an instructor looking at this sees what the student is actually
 * getting.
 */
const getLearnerDetail = async (callingUser, { courseId, studentId, now = new Date() } = {}) => {
  await assertInstructorCourseAccess(callingUser, courseId);

  if (!studentId) {
    const error = new Error("studentId is required");
    error.statusCode = 400;
    throw error;
  }

  // Enrolment on THIS course is the second half of the authorization: owning
  // the course does not entitle an instructor to a learner who is not on it.
  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_courseId: { studentId, courseId } },
    select: {
      progressPercent: true,
      completed: true,
      lastAccessedAt: true,
      enrolledAt: true,
      student: { select: { id: true, user: { select: { name: true, email: true } } } }
    }
  });

  if (!enrollment) {
    const error = new Error("Learner not found on this course");
    error.statusCode = 404;
    throw error;
  }

  const studentProfile = { id: studentId };

  const [path, signalRows, misconceptions, qualifying, recommendations, nextAction] =
    await Promise.all([
      progressService.getStudentLearningPath(studentId, courseId),
      retentionService.fetchSignalRows({ studentId, courseId }),
      prisma.knowledgeGap.findMany({
        where: { studentId },
        select: { concept: true, kc: true, type: true, status: true, severity: true, detectedAt: true }
      }),
      fetchQualifyingRows(courseId),
      recommendationService.getRecommendations(studentProfile, { courseId, limit: 5 }),
      nextActionService.getNextAction(studentProfile, { courseId })
    ]);

  // The same evaluators the student's own view uses.
  const signals = signalRows.map((row) => ({
    concept: row.concept,
    retention: retentionService.evaluateRetention(row, now),
    transfer: retentionService.evaluateTransfer(row),
    evidence: {
      questionsAnswered: row.answered,
      correct: row.correct,
      incorrect: row.answered - row.correct,
      lastSeenAt: row.lastSeenAt
    }
  }));

  const learner = {
    studentId,
    name: enrollment.student?.user?.name || "Unnamed learner",
    email: enrollment.student?.user?.email || null,
    progressPercent: enrollment.progressPercent ?? 0,
    completed: enrollment.completed === true,
    lastAccessedAt: enrollment.lastAccessedAt ?? null,
    enrolledAt: enrollment.enrolledAt ?? null
  };

  const learnerQualifying = qualifying.filter((row) => row.studentId === studentId);

  return {
    learner,
    reasons: buildAttentionReasons({
      learner,
      signals,
      misconceptions,
      qualifying: learnerQualifying,
      now
    }),
    // Titles and statuses only — the path's own ids stay server-side.
    position: {
      current: path.find((entry) => entry.status === "CURRENT")?.title ?? null,
      completed: path.filter((entry) => entry.status === "COMPLETED").length,
      qualified: path.filter((entry) => entry.qualified === true).length,
      locked: path.filter((entry) => entry.status === "LOCKED").length,
      total: path.length
    },
    signals,
    weakAreas: recommendations.weakAreas,
    misconceptions: misconceptions.map((row) => ({
      label: misconceptionLabel(row),
      concept: (row.kc || row.concept || "").trim() || null,
      unresolved: row.status === "OPEN",
      detectedAt: row.detectedAt
    })),
    qualifyingTests: learnerQualifying.map((row) => ({
      quizTitle: row.quizTitle,
      targetTitle: row.topicTitle || row.lessonTitle || null,
      attempts: row.attemptCount,
      passed: row.passed,
      passedOnAttempt: row.passedOnAttempt
    })),
    // What the deterministic engine is actually telling this learner —
    // reported so the instructor can see it, never so they can change it.
    adaptive: {
      nextAction: {
        headline: nextAction.primary.headline,
        title: nextAction.primary.title,
        reason: nextAction.primary.reason
      },
      recommendations: recommendations.recommendations.map((rec) => ({
        title: rec.title,
        reason: rec.reason,
        priority: rec.priority
      }))
    }
  };
};

module.exports = {
  assertInstructorCourseAccess,
  fetchEnrolledLearners,
  fetchMisconceptionRows,
  fetchQualifyingRows,
  misconceptionLabel,
  buildAttentionReasons,
  buildConceptInsights,
  buildMisconceptionInsights,
  buildQualifyingInsights,
  getCourseInsights,
  getLearnersNeedingAttention,
  getLearnerDetail
};
