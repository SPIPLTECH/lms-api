const prisma = require("../../config/database");
const progressService = require("../progress/progress.service");
// Required as a module, not destructured: a destructured binding is captured
// at require time, which makes this impossible to stub and quietly couples the
// two modules to load order.
const recommendationService = require("./recommendation.service");
const { DECISION_PRIORITY } = require("./decision.config");
// The one rule for how many attempts a student actually gets — the same one
// submit enforces. Never recomputed from Quiz.attempts here: a Self-Test is
// unlimited whatever that column happens to hold.
const { effectiveMaxAttempts } = require("../../utils/attemptAllowance");
const { QUALIFYING_TAG } = require("../../utils/qualification");

/**
 * The student's single primary next action.
 *
 * This composes decisions that already exist; it does not make new ones.
 * Three settled sources feed it, and each keeps its own authority:
 *
 *   - WHERE the student is, and what is locked: the Phase 2 learning path,
 *     which is also what the API enforces on access. Nothing here can open
 *     content the path says is locked.
 *   - WHAT their answers say: the Phase 6 recommendations, which are the
 *     existing deterministic decision engine (evaluatePedagogicalDecision)
 *     applied to their own mastery and evidence.
 *   - WHETHER a qualifying test is on offer or already spent: the Phase 2/4
 *     qualification rules, read from the attempt log.
 *
 * All this module adds is a priority order between them, and it is a fixed
 * table — no scoring, no model, no LLM. The same inputs always produce the
 * same action, which is what makes it safe for the thing a student is told
 * to do next.
 */

/** The action vocabulary the student-facing UI renders. */
const NEXT_ACTION = {
  COURSE_COMPLETED: "COURSE_COMPLETED",
  REVIEW_MISCONCEPTION: "REVIEW_MISCONCEPTION",
  REVIEW_TOPIC: "REVIEW_TOPIC",
  PRACTICE_TOPIC: "PRACTICE_TOPIC",
  TAKE_QUALIFYING_TEST: "TAKE_QUALIFYING_TEST",
  RETRY_QUALIFYING_TEST: "RETRY_QUALIFYING_TEST",
  RETRY_QUIZ: "RETRY_QUIZ",
  CONTINUE_LEARNING: "CONTINUE_LEARNING",
  CONTINUE_TO_NEXT_LESSON: "CONTINUE_TO_NEXT_LESSON",
  NOTHING_TO_DO: "NOTHING_TO_DO"
};

/**
 * Where a qualifying test stands for the student, at the node they are on.
 *
 * Read from the Phase 1 attempt log, which is the same source the
 * qualification rules use — so "can they retake" here can never disagree
 * with what submit would actually allow. The frontend is never asked to work
 * this out; §8 of the brief is explicit that the server owns it.
 */
const resolveQualifyingState = async (studentId, entry) => {
  if (!entry?.qualifyingQuiz?.id) return null;

  const attempts = await prisma.quizAttempt.findMany({
    where: { studentId, quizId: entry.qualifyingQuiz.id },
    orderBy: { attemptNumber: "asc" },
    select: { attemptNumber: true, passed: true, percentage: true }
  });

  const passed = attempts.some((a) => a.passed === true);
  // A qualifying test is never a SELF_TEST, so this is its stored limit — but
  // it is read through the shared rule so the two can never drift.
  const limit = effectiveMaxAttempts({ ...entry.qualifyingQuiz, quizTag: QUALIFYING_TAG });
  const maxAttempts = Number(limit) > 0 ? limit : null;
  // A null limit means unlimited.
  const canRetake = !passed && (maxAttempts === null || attempts.length < maxAttempts);

  return {
    quizId: entry.qualifyingQuiz.id,
    title: entry.qualifyingQuiz.title,
    passingScore: entry.qualifyingQuiz.passingScore,
    questionCount: entry.qualifyingQuiz.questionCount,
    attemptsUsed: attempts.length,
    maxAttempts,
    passed,
    // The server's answer, carried verbatim to the UI.
    canRetake,
    lastPercentage: attempts.length ? attempts[attempts.length - 1].percentage : null
  };
};

/**
 * The quiz a student has just submitted, as context for the result page.
 *
 * Only ever used to re-rank actions the priority table already produced — it
 * never unlocks anything and never grants an attempt. `canRetake` is computed
 * from the same attempt log and the same `attempts` allowance that submit
 * enforces, so it cannot offer a retake the server would then refuse.
 *
 * A quizId that belongs to another course resolves to null and is ignored,
 * so the parameter cannot be used to probe quizzes outside this course.
 */
const resolveSubmittedQuizContext = async (studentId, courseId, quizId) => {
  if (!quizId) return null;

  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: { id: true, title: true, courseId: true, quizTag: true, attempts: true, lessonId: true, topicId: true, moduleId: true }
  });

  if (!quiz || quiz.courseId !== courseId) return null;

  const attempts = await prisma.quizAttempt.findMany({
    where: { studentId, quizId },
    orderBy: { attemptNumber: "asc" },
    select: { attemptNumber: true, passed: true }
  });

  if (attempts.length === 0) return null;

  const passed = attempts.some((a) => a.passed === true);
  // Not `quiz.attempts` — see effectiveMaxAttempts. A Self-Test reports the
  // schema default of 1 while submit lets the student retake it forever, and
  // telling them "1 of 1 attempts used" under a working Retry button is a
  // straight contradiction.
  const limit = effectiveMaxAttempts(quiz);
  const maxAttempts = Number(limit) > 0 ? limit : null;

  return {
    quizId: quiz.id,
    title: quiz.title,
    isQualifying: quiz.quizTag === QUALIFYING_TAG,
    lessonId: quiz.lessonId ?? null,
    topicId: quiz.topicId ?? null,
    moduleId: quiz.moduleId ?? null,
    passed,
    attemptsUsed: attempts.length,
    maxAttempts,
    canRetake: !passed && (maxAttempts === null || attempts.length < maxAttempts)
  };
};

/**
 * Re-ranks the table's answer in light of the quiz just submitted.
 *
 * Deliberately a post-step over the fixed table rather than a branch inside
 * it: the table stays the single place actions are chosen, and this can only
 * reorder what it already returned. Three rules, in order:
 *
 *   - A QUALIFYING test keeps the table's verdict as the headline, always.
 *     Rule 3 IS the qualification rule: a failed qualifying test points at
 *     the lesson, with the retry demoted to a secondary offer. Promoting the
 *     retry here would be a second, competing qualification rule.
 *
 *     What this does add is the retry itself when rule 3 could not reach it.
 *     Rule 3 reads the qualifying quiz off the path's CURRENT entry, but a
 *     lesson's qualifying test is attached to the LESSON while the student's
 *     current entry is usually a topic inside it — so a student who has just
 *     failed that test is shown a result page with no mention of the retake
 *     they still have. The offer is appended, never promoted, and only on
 *     the server's own `canRetake`.
 *   - A passed quiz, or one with no attempts left, changes nothing. The
 *     student's next step is wherever the path says it is.
 *   - A failed, retryable quiz becomes the headline UNLESS the table led with
 *     a review: a student who just failed on a flagged misconception should
 *     review before retrying, so the retry drops to a secondary offer.
 */
const REVIEW_ACTIONS = new Set([NEXT_ACTION.REVIEW_TOPIC, NEXT_ACTION.REVIEW_MISCONCEPTION]);
const QUALIFYING_ACTIONS = new Set([
  NEXT_ACTION.TAKE_QUALIFYING_TEST,
  NEXT_ACTION.RETRY_QUALIFYING_TEST
]);

const applySubmittedQuizContext = (base, context, courseId) => {
  if (!context || context.passed || !context.canRetake) return base;

  if (context.isQualifying) {
    // Rule 3 already said it — don't say it twice.
    const alreadyOffered = [base.primary, ...base.secondary].some(
      (offer) => QUALIFYING_ACTIONS.has(offer?.action) && offer?.target?.quizId === context.quizId
    );
    if (alreadyOffered) return base;

    return {
      ...base,
      secondary: [
        ...base.secondary,
        {
          action: NEXT_ACTION.RETRY_QUALIFYING_TEST,
          title: "Try the qualifying test again",
          reason:
            context.maxAttempts === null
              ? "You can retake this qualifying test."
              : `${context.attemptsUsed} of ${context.maxAttempts} attempts used.`,
          cta: "Try Again",
          target: { courseId, quizId: context.quizId }
        }
      ]
    };
  }

  const retry = {
    action: NEXT_ACTION.RETRY_QUIZ,
    headline: "Try again",
    title: context.title,
    reason:
      context.maxAttempts === null
        ? "You didn't pass this time — you can retake this quiz."
        : `You didn't pass this time — ${context.attemptsUsed} of ${context.maxAttempts} attempts used.`,
    cta: "Retry Quiz",
    target: {
      courseId,
      quizId: context.quizId,
      lessonId: context.lessonId,
      topicId: context.topicId,
      moduleId: context.moduleId,
      title: context.title,
      kind: "QUIZ"
    }
  };

  // Review first: the retry is offered, it just doesn't lead.
  if (REVIEW_ACTIONS.has(base.primary?.action)) {
    return { ...base, secondary: [...base.secondary, retry] };
  }

  const demoted = base.primary?.cta ? [base.primary] : [];
  return { ...base, primary: retry, secondary: [...demoted, ...base.secondary] };
};

/** A link the player can actually open, built from ids the path vouched for. */
const buildTarget = (courseId, entry) => ({
  courseId,
  moduleId: entry?.moduleId ?? null,
  lessonId: entry?.lessonId ?? null,
  topicId: entry?.topicId ?? null,
  title: entry?.title ?? null,
  kind: entry?.kind ?? null
});

/**
 * The single action, plus anything worth offering alongside it.
 *
 * The priority table, highest first:
 *
 *   1. Everything is settled            -> COURSE_COMPLETED
 *   2. A HIGH-priority adaptive signal  -> REVIEW_MISCONCEPTION / REVIEW_TOPIC
 *   3. A qualifying test already failed -> CONTINUE_LEARNING (retry offered
 *                                          only as a secondary, per §8)
 *   4. A qualifying test on offer,
 *      not yet attempted                -> TAKE_QUALIFYING_TEST
 *   5. Somewhere to carry on            -> CONTINUE_LEARNING
 *   6. Lower-priority adaptive signal   -> PRACTICE_TOPIC
 *   7. Nothing actionable               -> NOTHING_TO_DO
 *
 * Rule 3 is deliberate: a student who has just failed the test that would let
 * them skip a lesson should be pointed at the lesson, not at the test again.
 * The retry stays available, it just stops being the headline.
 *
 * @param {object} studentProfile  already resolved AND authorized by the
 *   caller (resolveStudentProfile) — this function never re-checks identity
 *   and must not be handed an unverified profile.
 */
const buildBaseNextAction = async (studentProfile, { courseId }) => {
  if (!courseId) {
    const error = new Error("courseId is required");
    error.statusCode = 400;
    throw error;
  }

  const studentId = studentProfile.id;

  // Both are aggregated server-side already; this is two calls, not a fan-out
  // per concept or per attempt.
  const [path, adaptive] = await Promise.all([
    progressService.getStudentLearningPath(studentId, courseId),
    recommendationService.getRecommendations(studentProfile, { courseId, limit: 5 })
  ]);

  const current = path.find((entry) => entry.status === "CURRENT") || null;
  const secondary = [];

  // ---- 1. Nothing left to do -------------------------------------------
  const applicable = path.filter((entry) => entry.applicable !== false);
  const allSettled = applicable.length > 0 && applicable.every((entry) => entry.satisfied);

  if (allSettled) {
    return {
      primary: {
        action: NEXT_ACTION.COURSE_COMPLETED,
        headline: "Course Complete",
        title: "You've completed the required learning path",
        reason: "Every lesson is either completed or qualified.",
        cta: null,
        target: { courseId }
      },
      secondary: [],
      // Reported so the UI can show "Qualified to Skip" distinctly from
      // "Completed" — §10 is explicit that the two must not be conflated.
      qualifiedCount: path.filter((entry) => entry.qualified).length
    };
  }

  const qualifying = current ? await resolveQualifyingState(studentId, current) : null;

  // ---- 2. A high-priority adaptive signal -------------------------------
  // The priority is the decision engine's, not this module's. What this adds
  // is a bar for PROMOTING one to the headline.
  //
  // A single wrong answer is enough for the engine to flag a concept, and
  // rightly so — it is one input among many to a mastery estimate. It is not
  // enough to tell a student, in the most prominent thing on the page, that
  // reviewing a whole topic is the most important thing they could do. That
  // overstates what one question supports, and it is how a student learns to
  // ignore the card entirely.
  //
  // So a recommendation whose evidence is one missed question stays available
  // as a secondary offer and in Areas to Improve; it just doesn't lead. A
  // recommendation with no question-level evidence at all (mastery decay, or
  // a recorded misconception) is promotable — that signal came from somewhere
  // other than a lone answer.
  const MIN_MISSED_TO_LEAD = 2;
  const isPromotable = (rec) => {
    if (!rec.evidence) return true;
    return (rec.evidence.incorrect ?? 0) + (rec.evidence.skipped ?? 0) >= MIN_MISSED_TO_LEAD;
  };

  const highPriority = adaptive.recommendations.filter(
    (rec) => rec.priority === DECISION_PRIORITY.HIGH
  );
  const urgent = highPriority.find(isPromotable);

  if (urgent) {
    if (current) {
      secondary.push({
        action: NEXT_ACTION.CONTINUE_LEARNING,
        title: current.title,
        reason: "Carry on where you left off.",
        cta: "Continue",
        target: buildTarget(courseId, current)
      });
    }

    return {
      primary: {
        action:
          urgent.type === "REVIEW_CONCEPT"
            ? NEXT_ACTION.REVIEW_TOPIC
            : NEXT_ACTION.PRACTICE_TOPIC,
        headline: "Your next step",
        title: urgent.title,
        // Already student-friendly and evidence-backed — no internal scores,
        // no misconception identifiers.
        reason: urgent.reason,
        cta: urgent.action?.label || "Review Topic",
        target: {
          courseId,
          moduleId: urgent.target?.moduleId ?? null,
          lessonId: urgent.target?.lessonId ?? null,
          topicId: urgent.target?.topicId ?? null,
          title: urgent.target?.title ?? null,
          kind: "TOPIC"
        }
      },
      secondary,
      qualifiedCount: path.filter((entry) => entry.qualified).length
    };
  }

  // ---- 3/4. Qualifying test at the student's current position -----------
  if (qualifying && !qualifying.passed) {
    const hasFailedAttempt = qualifying.attemptsUsed > 0;

    if (hasFailedAttempt) {
      // Failed already: work the lesson, retry second.
      if (qualifying.canRetake) {
        secondary.push({
          action: NEXT_ACTION.RETRY_QUALIFYING_TEST,
          title: "Try the qualifying test again",
          reason: `${qualifying.attemptsUsed} of ${qualifying.maxAttempts ?? "unlimited"} attempts used.`,
          cta: "Try Again",
          target: { courseId, quizId: qualifying.quizId }
        });
      }

      return {
        primary: {
          action: NEXT_ACTION.CONTINUE_LEARNING,
          headline: "Keep learning",
          title: current.title,
          reason: qualifying.canRetake
            ? "Review the lesson before trying the qualifying test again."
            : "You've used all qualifying attempts — work through the lesson to continue.",
          cta: "Continue Learning",
          target: buildTarget(courseId, current)
        },
        secondary,
        qualifiedCount: path.filter((entry) => entry.qualified).length
      };
    }

    // Never attempted: offering the shortcut is genuinely useful here.
    secondary.push({
      action: NEXT_ACTION.CONTINUE_LEARNING,
      title: current.title,
      reason: "Or work through it as normal.",
      cta: "Continue Learning",
      target: buildTarget(courseId, current)
    });

    return {
      primary: {
        action: NEXT_ACTION.TAKE_QUALIFYING_TEST,
        headline: "Ready to check your knowledge?",
        title: `Skip ${current.title}`,
        reason: `Take a short qualifying test — ${qualifying.questionCount} questions, ${qualifying.passingScore}% to pass.`,
        cta: "Take Qualifying Test",
        target: { courseId, quizId: qualifying.quizId, lessonId: current.lessonId, topicId: current.topicId }
      },
      secondary,
      qualifiedCount: path.filter((entry) => entry.qualified).length
    };
  }

  // ---- 5. Carry on ------------------------------------------------------
  if (current) {
    const lowerPriority = adaptive.recommendations[0];
    if (lowerPriority) {
      secondary.push({
        action: NEXT_ACTION.PRACTICE_TOPIC,
        title: lowerPriority.title,
        reason: lowerPriority.reason,
        cta: lowerPriority.action?.label || "Practise",
        target: {
          courseId,
          moduleId: lowerPriority.target?.moduleId ?? null,
          lessonId: lowerPriority.target?.lessonId ?? null,
          topicId: lowerPriority.target?.topicId ?? null,
          title: lowerPriority.target?.title ?? null,
          kind: "TOPIC"
        }
      });
    }

    // A lesson the student qualified out of reads differently from one they
    // finished, so the headline says so rather than claiming completion.
    const previous = path[path.indexOf(current) - 1];
    const followsQualified = previous?.qualified === true;

    return {
      primary: {
        action: followsQualified ? NEXT_ACTION.CONTINUE_TO_NEXT_LESSON : NEXT_ACTION.CONTINUE_LEARNING,
        headline: followsQualified ? "Qualified" : "Continue Learning",
        title: current.title,
        reason: followsQualified
          ? "You've demonstrated sufficient understanding of the previous lesson."
          : "Continue where you left off.",
        cta: followsQualified ? "Continue to Next Lesson" : "Continue",
        target: buildTarget(courseId, current)
      },
      secondary,
      qualifiedCount: path.filter((entry) => entry.qualified).length
    };
  }

  // ---- 7. Nothing actionable -------------------------------------------
  // A course with no trackable content, or a path that could not be built.
  // Reported honestly rather than inventing something to click.
  return {
    primary: {
      action: NEXT_ACTION.NOTHING_TO_DO,
      headline: "Nothing to do yet",
      title: null,
      reason: "There's no learning content available in this course yet.",
      cta: null,
      target: { courseId }
    },
    secondary: [],
    qualifiedCount: 0
  };
};

/**
 * The student's next action, optionally in the context of a quiz they have
 * just submitted (`quizId`) — which is what the quiz result page passes.
 *
 * Without `quizId` this is exactly the priority table above, unchanged. With
 * it, the table still chooses; the quiz context can only re-rank the result
 * (see applySubmittedQuizContext), and only ever within what the server
 * already permits.
 */
const getNextAction = async (studentProfile, { courseId, quizId = null }) => {
  const base = await buildBaseNextAction(studentProfile, { courseId });
  if (!quizId) return base;

  const context = await resolveSubmittedQuizContext(studentProfile.id, courseId, quizId);
  return applySubmittedQuizContext(base, context, courseId);
};

module.exports = {
  NEXT_ACTION,
  resolveQualifyingState,
  resolveSubmittedQuizContext,
  getNextAction
};
