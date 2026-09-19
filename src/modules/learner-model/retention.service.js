const prisma = require("../../config/database");
const {
  RETENTION_STATUS,
  TRANSFER_STATUS,
  CALIBRATION_STATUS,
  RETENTION_CONFIG,
  CALIBRATION_CAPTURE_NOTE
} = require("./retention.config");

/**
 * Phase 8 — long-term learning signals.
 *
 * Phases 1–7 answer "how is this student doing right now". This answers a
 * different question: does what they demonstrated LAST week still hold, and
 * can they use it anywhere other than where they learned it.
 *
 * It is not a second adaptive engine. It produces evidence; the existing
 * deterministic engine (evaluatePedagogicalDecision) and the existing
 * recommendation/next-action pipeline still decide what happens. Nothing
 * here unlocks content, grants an attempt, passes a student, or chooses a
 * mandatory action, and no LLM is consulted anywhere in this file.
 *
 * All three signals are pure functions of counts the database produced. Given
 * the same rows they return the same answer, every time.
 */

/**
 * Every longitudinal count, per (student, concept), in ONE round trip.
 *
 * Aggregated entirely in Postgres. The alternative — reading QuestionAttempt
 * rows into JavaScript and grouping them there — is what §8 of the Phase 8
 * brief rules out, and it would grow without bound as a course fills up.
 *
 * Grouped by student AND concept so that ONE query and ONE set of formulas
 * serve both readers: a student asking about themselves, and Phase 9's
 * instructor analytics asking about a whole course. The instructor view
 * classifies each learner with the same evaluateRetention/evaluateTransfer
 * the student view uses — the definitions are not restated anywhere.
 *
 * The CTE runs in three stages:
 *   obs    — every graded observation, flattened to (student, concept, when)
 *   firsts — the first time each student answered each concept correctly
 *   delayed— observations at least GAP_DAYS after that first success
 *
 * `delayed` is the whole point. An answer in the same sitting as the first
 * success is not evidence of retention, so the interval is applied in SQL
 * rather than being approximated afterwards.
 *
 * Both filters are optional but at least one is required: an unbounded scan
 * across every student in the installation is never a legitimate request, and
 * refusing it here means no caller can make it by accident.
 *
 * @param {object} scope
 * @param {string|null} scope.studentId  already authorized by the caller
 * @param {string|null} scope.courseId   already authorized by the caller
 */
const fetchSignalRows = async ({ studentId = null, courseId = null } = {}) => {
  if (!studentId && !courseId) {
    const error = new Error("a studentId or a courseId is required");
    error.statusCode = 400;
    throw error;
  }

  const gapDays = RETENTION_CONFIG.GAP_DAYS;

  const rows = await prisma.$queryRaw`
    WITH obs AS (
      SELECT a."studentId"      AS student_id,
             btrim(q."topic")   AS concept,
             qa."questionId"    AS question_id,
             a."quizId"         AS quiz_id,
             qa."answered"      AS answered,
             qa."isCorrect"     AS is_correct,
             a."submittedAt"    AS seen_at
        FROM "QuestionAttempt" qa
        JOIN "QuizAttempt"  a ON a."id" = qa."quizAttemptId"
        JOIN "Question"     q ON q."id" = qa."questionId"
        JOIN "Quiz"         z ON z."id" = a."quizId"
       WHERE q."topic" IS NOT NULL
         AND btrim(q."topic") <> ''
         AND (${studentId}::text IS NULL OR a."studentId" = ${studentId})
         AND (${courseId}::text IS NULL OR z."courseId" = ${courseId})
    ),
    firsts AS (
      SELECT student_id, concept, MIN(seen_at) AS first_correct_at
        FROM obs
       WHERE is_correct IS TRUE
       GROUP BY student_id, concept
    ),
    delayed AS (
      SELECT o.student_id,
             o.concept,
             COUNT(*) FILTER (WHERE o.answered IS TRUE)   AS delayed_answered,
             COUNT(*) FILTER (WHERE o.is_correct IS TRUE) AS delayed_correct
        FROM obs o
        JOIN firsts f
          ON f.student_id = o.student_id AND f.concept = o.concept
       WHERE o.seen_at >= f.first_correct_at + make_interval(days => ${gapDays}::int)
       GROUP BY o.student_id, o.concept
    )
    SELECT o.student_id                                                      AS "studentId",
           o.concept                                                         AS "concept",
           COUNT(*) FILTER (WHERE o.answered IS TRUE)                        AS "answered",
           COUNT(*) FILTER (WHERE o.is_correct IS TRUE)                      AS "correct",
           COUNT(DISTINCT o.question_id)                                     AS "distinctSeen",
           COUNT(DISTINCT o.question_id) FILTER (WHERE o.is_correct IS TRUE) AS "distinctCorrectQuestions",
           COUNT(DISTINCT o.quiz_id)     FILTER (WHERE o.is_correct IS TRUE) AS "distinctCorrectQuizzes",
           MAX(o.seen_at) FILTER (WHERE o.answered IS TRUE)                  AS "lastSeenAt",
           MIN(f.first_correct_at)                                           AS "firstCorrectAt",
           COALESCE(MAX(d.delayed_answered), 0)                              AS "delayedAnswered",
           COALESCE(MAX(d.delayed_correct), 0)                               AS "delayedCorrect"
      FROM obs o
      LEFT JOIN firsts  f ON f.student_id = o.student_id AND f.concept = o.concept
      LEFT JOIN delayed d ON d.student_id = o.student_id AND d.concept = o.concept
     GROUP BY o.student_id, o.concept
  `;

  // COUNT() comes back as BigInt; every consumer wants a Number.
  return rows.map((row) => ({
    studentId: row.studentId,
    concept: row.concept,
    answered: Number(row.answered),
    correct: Number(row.correct),
    distinctSeen: Number(row.distinctSeen),
    distinctCorrectQuestions: Number(row.distinctCorrectQuestions),
    distinctCorrectQuizzes: Number(row.distinctCorrectQuizzes),
    lastSeenAt: row.lastSeenAt ?? null,
    firstCorrectAt: row.firstCorrectAt ?? null,
    delayedAnswered: Number(row.delayedAnswered),
    delayedCorrect: Number(row.delayedCorrect)
  }));
};

/** One student's rows. Kept as its own name because that is how Phase 8 reads. */
const fetchConceptSignalRows = async (studentId, courseId = null) =>
  module.exports.fetchSignalRows({ studentId, courseId });

/** Whole days between two instants, floored. */
const daysBetween = (from, to) => {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 86_400_000);
};

/**
 * RETENTION — does an earlier success still hold?
 *
 * Deliberately says nothing unless there is delayed evidence to say it with.
 * A student who has only ever seen a concept once, however well they did,
 * gets INSUFFICIENT_EVIDENCE — not "retained". Claiming retention from a
 * single sitting would be the most tempting and least defensible shortcut
 * available here.
 *
 * Formula, in full:
 *   delayed        = answers at least GAP_DAYS after the FIRST correct answer
 *   retentionRate  = delayedCorrect / delayedAnswered
 *   RETAINED       when delayedAnswered >= MIN and rate >= RETAINED_MIN_RATE
 *   DECAYED        when delayedAnswered >= MIN and rate <= DECAYED_MAX_RATE
 *   SHAKY          otherwise, with enough evidence
 *   dueForReview   demonstrated, not decayed, and untouched for REVIEW_DUE_DAYS
 */
const evaluateRetention = (row, now = new Date()) => {
  const {
    GAP_DAYS,
    MIN_DELAYED_OBSERVATIONS,
    RETAINED_MIN_RATE,
    DECAYED_MAX_RATE,
    REVIEW_DUE_DAYS
  } = RETENTION_CONFIG;

  const daysSinceLastSeen = daysBetween(row.lastSeenAt, now);
  const everCorrect = row.correct > 0;

  // Never demonstrated, or never revisited after demonstrating: there is
  // nothing to say about durability yet.
  if (!everCorrect || row.delayedAnswered < MIN_DELAYED_OBSERVATIONS) {
    return {
      status: RETENTION_STATUS.INSUFFICIENT_EVIDENCE,
      retentionRate: null,
      delayedAnswered: row.delayedAnswered,
      delayedCorrect: row.delayedCorrect,
      gapDays: GAP_DAYS,
      daysSinceLastSeen,
      // A concept demonstrated once and untouched since is still worth a
      // look, even though its durability is unmeasured.
      dueForReview:
        everCorrect && daysSinceLastSeen !== null && daysSinceLastSeen >= REVIEW_DUE_DAYS
    };
  }

  const retentionRate = row.delayedCorrect / row.delayedAnswered;

  let status = RETENTION_STATUS.SHAKY;
  if (retentionRate >= RETAINED_MIN_RATE) status = RETENTION_STATUS.RETAINED;
  else if (retentionRate <= DECAYED_MAX_RATE) status = RETENTION_STATUS.DECAYED;

  return {
    status,
    retentionRate: Number(retentionRate.toFixed(4)),
    delayedAnswered: row.delayedAnswered,
    delayedCorrect: row.delayedCorrect,
    gapDays: GAP_DAYS,
    daysSinceLastSeen,
    // Already decayed is not "due for review" — it is a live problem, and the
    // recommendation it produces says so in stronger terms.
    dueForReview:
      status !== RETENTION_STATUS.DECAYED &&
      daysSinceLastSeen !== null &&
      daysSinceLastSeen >= REVIEW_DUE_DAYS
  };
};

/**
 * TRANSFER — can the concept be used somewhere other than where it was met?
 *
 * The brief is explicit that answering the same concept correctly again is
 * not transfer, so neither is it here. Transfer requires correct answers on
 * at least TRANSFER_MIN_DISTINCT_QUESTIONS distinct questions spread across
 * at least TRANSFER_MIN_DISTINCT_QUIZZES distinct quizzes — a different
 * question AND a different paper.
 *
 * REPEATED_ONLY is the interesting middle: the student is getting it right,
 * but every success so far is the same question or the same sitting. That is
 * a reason to offer practice in a new context, not a reason to worry.
 */
const evaluateTransfer = (row) => {
  const {
    TRANSFER_MIN_DISTINCT_QUESTIONS,
    TRANSFER_MIN_DISTINCT_QUIZZES,
    TRANSFER_MIN_DISTINCT_SEEN
  } = RETENTION_CONFIG;

  const evidence = {
    distinctCorrectQuestions: row.distinctCorrectQuestions,
    distinctCorrectQuizzes: row.distinctCorrectQuizzes,
    distinctSeen: row.distinctSeen
  };

  // Only ever met one question on this concept: no opportunity to transfer
  // has arisen, which is not the same as having failed to.
  if (row.distinctSeen < TRANSFER_MIN_DISTINCT_SEEN) {
    return { status: TRANSFER_STATUS.INSUFFICIENT_EVIDENCE, ...evidence };
  }

  if (row.correct === 0) {
    return { status: TRANSFER_STATUS.NOT_DEMONSTRATED, ...evidence };
  }

  const transferred =
    row.distinctCorrectQuestions >= TRANSFER_MIN_DISTINCT_QUESTIONS &&
    row.distinctCorrectQuizzes >= TRANSFER_MIN_DISTINCT_QUIZZES;

  return {
    status: transferred ? TRANSFER_STATUS.TRANSFERRED : TRANSFER_STATUS.REPEATED_ONLY,
    ...evidence
  };
};

/**
 * CALIBRATION — did the student's certainty match their correctness?
 *
 * Nothing records certainty today (see CALIBRATION_CAPTURE_NOTE), so in this
 * codebase this function is always handed an empty list and always returns
 * UNAVAILABLE. It is written and tested anyway, against the shape the data
 * would take, so that capturing confidence later is a wiring job rather than
 * a design one — and so the "high confidence + repeated incorrect" rule the
 * brief asks about is pinned by a test now rather than improvised then.
 *
 * @param {Array<{confidence: number, isCorrect: boolean}>} observations
 */
const evaluateCalibration = (observations = []) => {
  const {
    CALIBRATION_MIN_OBSERVATIONS,
    CALIBRATION_HIGH_CONFIDENCE,
    CALIBRATION_LOW_CONFIDENCE,
    OVERCONFIDENT_MAX_ACCURACY,
    UNDERCONFIDENT_MIN_ACCURACY
  } = RETENTION_CONFIG;

  const usable = (observations || []).filter(
    (o) => typeof o?.confidence === "number" && typeof o?.isCorrect === "boolean"
  );

  if (usable.length < CALIBRATION_MIN_OBSERVATIONS) {
    return {
      status: CALIBRATION_STATUS.UNAVAILABLE,
      observations: usable.length,
      note: CALIBRATION_CAPTURE_NOTE
    };
  }

  const confident = usable.filter((o) => o.confidence >= CALIBRATION_HIGH_CONFIDENCE);
  const unsure = usable.filter((o) => o.confidence <= CALIBRATION_LOW_CONFIDENCE);

  const rate = (group) =>
    group.length === 0 ? null : group.filter((o) => o.isCorrect).length / group.length;

  const confidentAccuracy = rate(confident);
  const unsureAccuracy = rate(unsure);

  // Sure and wrong is the one worth intervening on: it is the state in which
  // a student stops checking their own work.
  if (
    confident.length >= CALIBRATION_MIN_OBSERVATIONS &&
    confidentAccuracy !== null &&
    confidentAccuracy <= OVERCONFIDENT_MAX_ACCURACY
  ) {
    return {
      status: CALIBRATION_STATUS.OVERCONFIDENT,
      observations: usable.length,
      confidentAccuracy: Number(confidentAccuracy.toFixed(4))
    };
  }

  if (
    unsure.length >= CALIBRATION_MIN_OBSERVATIONS &&
    unsureAccuracy !== null &&
    unsureAccuracy >= UNDERCONFIDENT_MIN_ACCURACY
  ) {
    return {
      status: CALIBRATION_STATUS.UNDERCONFIDENT,
      observations: usable.length,
      unsureAccuracy: Number(unsureAccuracy.toFixed(4))
    };
  }

  return { status: CALIBRATION_STATUS.WELL_CALIBRATED, observations: usable.length };
};

/**
 * Student-facing wording for a signal.
 *
 * Written here, in the deterministic layer, on purpose: these are fixed
 * strings chosen by a fixed rule, not text a model generates. The LLM's role
 * in this codebase is explanatory language around misconceptions; it has no
 * part in deciding or describing a retention status, and if it were
 * unavailable this function would behave identically.
 */
const LABELS = {
  [RETENTION_STATUS.RETAINED]: "Strong understanding",
  [RETENTION_STATUS.SHAKY]: "Needs a quick review",
  [RETENTION_STATUS.DECAYED]: "Review recommended",
  [RETENTION_STATUS.INSUFFICIENT_EVIDENCE]: "Still building evidence"
};

/**
 * Why a concept is REPEATED_ONLY, in the student's terms.
 *
 * Transfer can fail on either half of its rule, and the two are different
 * facts: "you have only ever got this one question right" is not the same as
 * "you have got several right, but all in one quiz". Saying the wrong one is
 * a small lie about the student's own history, and they are the one person
 * who can tell.
 */
const repeatedDetail = (transfer) => {
  const { TRANSFER_MIN_DISTINCT_QUESTIONS } = RETENTION_CONFIG;

  if (transfer.distinctCorrectQuestions < TRANSFER_MIN_DISTINCT_QUESTIONS) {
    return "Your correct answers so far are all on the same question.";
  }
  return "Your correct answers so far have all come from the same quiz.";
};

const describeSignal = ({ retention, transfer }) => {
  if (retention.status === RETENTION_STATUS.DECAYED) {
    return {
      label: LABELS[RETENTION_STATUS.DECAYED],
      detail: "You had this earlier, but recent questions on it didn't go as well."
    };
  }

  if (retention.status === RETENTION_STATUS.SHAKY) {
    return {
      label: LABELS[RETENTION_STATUS.SHAKY],
      detail: "You're getting some of these right after a break, and some not."
    };
  }

  if (retention.status === RETENTION_STATUS.RETAINED) {
    if (transfer.status === TRANSFER_STATUS.REPEATED_ONLY) {
      return {
        label: "Practice applying this concept",
        detail: `You're reliable on what you've seen. ${repeatedDetail(transfer)} Worth trying it somewhere new.`
      };
    }
    return {
      label: LABELS[RETENTION_STATUS.RETAINED],
      detail:
        transfer.status === TRANSFER_STATUS.TRANSFERRED
          ? "You've applied this correctly in more than one place, over time."
          : "This has held up when it came back later."
    };
  }

  if (retention.dueForReview) {
    return {
      label: LABELS[RETENTION_STATUS.SHAKY],
      detail: "It's been a while since you worked on this one."
    };
  }

  if (transfer.status === TRANSFER_STATUS.REPEATED_ONLY) {
    return {
      label: "Practice applying this concept",
      detail: repeatedDetail(transfer)
    };
  }

  return {
    label: LABELS[RETENTION_STATUS.INSUFFICIENT_EVIDENCE],
    detail: "Not enough spaced-out attempts yet to say how well this is sticking."
  };
};

/**
 * The per-concept signals for one student.
 *
 * @param {object} studentProfile  already resolved AND authorized by the
 *   caller (resolveStudentProfile) — this never re-checks identity and must
 *   not be handed an unverified profile.
 */
const getLearningSignals = async (studentProfile, { courseId = null, now = new Date() } = {}) => {
  const rows = await module.exports.fetchConceptSignalRows(studentProfile.id, courseId);

  const signals = rows.map((row) => {
    const retention = evaluateRetention(row, now);
    const transfer = evaluateTransfer(row);
    const { label, detail } = describeSignal({ retention, transfer });

    return {
      concept: row.concept,
      label,
      detail,
      retention,
      transfer,
      // Counts of the student's own answers — never a mastery probability, a
      // BKT confidence or any other internal model estimate.
      evidence: {
        questionsAnswered: row.answered,
        correct: row.correct,
        distinctQuestionsSeen: row.distinctSeen,
        lastSeenAt: row.lastSeenAt
      }
    };
  });

  // Most actionable first, then by how much evidence stands behind it, then
  // alphabetically so the order is total and does not depend on row order.
  const RANK = {
    [RETENTION_STATUS.DECAYED]: 0,
    [RETENTION_STATUS.SHAKY]: 1,
    [RETENTION_STATUS.INSUFFICIENT_EVIDENCE]: 2,
    [RETENTION_STATUS.RETAINED]: 3
  };

  signals.sort((a, b) => {
    const byStatus = RANK[a.retention.status] - RANK[b.retention.status];
    if (byStatus !== 0) return byStatus;
    const byEvidence = b.evidence.questionsAnswered - a.evidence.questionsAnswered;
    if (byEvidence !== 0) return byEvidence;
    return a.concept.localeCompare(b.concept);
  });

  return {
    signals,
    // Reported honestly rather than omitted: a UI that knows calibration is
    // unavailable can say nothing, instead of showing a confident-looking zero.
    calibration: evaluateCalibration([])
  };
};

/**
 * Every learner's signals for one course, for Phase 9's instructor analytics.
 *
 * Deliberately built on the SAME query and the SAME evaluators as the student
 * view above. The instructor's "3 learners have decayed on Recursion" and the
 * student's "Review recommended" are then the same judgement counted twice,
 * not two definitions that can drift apart. Nothing about retention or
 * transfer is restated here.
 *
 * Returns one entry per (student, concept) that has evidence. That grid is
 * the minimum needed to classify each learner individually — it is produced
 * by a single GROUP BY, never by reading raw attempts — but it does grow as
 * learners × concepts, so the caller bounds what it does with it.
 *
 * @param {string} courseId  already authorized by the caller
 */
const getCourseLearningSignals = async (courseId, { now = new Date() } = {}) => {
  const rows = await module.exports.fetchSignalRows({ courseId });

  return rows.map((row) => ({
    studentId: row.studentId,
    concept: row.concept,
    retention: evaluateRetention(row, now),
    transfer: evaluateTransfer(row),
    evidence: {
      questionsAnswered: row.answered,
      correct: row.correct,
      incorrect: row.answered - row.correct,
      distinctQuestionsSeen: row.distinctSeen,
      lastSeenAt: row.lastSeenAt
    }
  }));
};

module.exports = {
  RETENTION_STATUS,
  fetchSignalRows,
  getCourseLearningSignals,
  TRANSFER_STATUS,
  CALIBRATION_STATUS,
  fetchConceptSignalRows,
  evaluateRetention,
  evaluateTransfer,
  evaluateCalibration,
  describeSignal,
  getLearningSignals
};
