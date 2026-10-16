const prisma = require("../config/database");
const { resolveQualificationTarget } = require("./qualification");

/**
 * What a qualifying attempt means: qualified or not, and — when not — which
 * material to send the student back to.
 *
 * The recommendations are read off data that already exists, not guessed at.
 * Phase 1 stores one QuestionAttempt per question per attempt, each with the
 * server's own `isCorrect`; every Question already carries the concept it
 * tests in `Question.topic`, the same field the learner model uses as its KC.
 * So "which concepts did they get wrong" is a group-by over rows that are
 * already there, and the content to revisit is the target's own published
 * children — the lesson/topic they just failed to skip.
 *
 * Nothing here calls an LLM or infers anything. The pass/fail decision is
 * QuizAttempt.passed, decided at submit time against the quiz's passingScore;
 * this module only reports it and explains it.
 */

/** A concept name that is really a concept, not a placeholder. */
const isRealConcept = (value) => {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.toLowerCase() !== "general";
};

const normalize = (value) => String(value || "").trim().toLowerCase();

/**
 * Concepts the student got wrong in this attempt, worst first.
 *
 * Counted per concept over the attempt's own question records: how many of
 * that concept's questions were answered incorrectly, out of how many were
 * asked. A question left unanswered counts as not demonstrated — the student
 * did not show the concept either way, so it is reported as missed rather
 * than silently dropped.
 */
const summarizeWeakConcepts = (questionAttempts = []) => {
  const byConcept = new Map();

  for (const row of questionAttempts) {
    const concept = row.question?.topic;
    if (!isRealConcept(concept)) continue;

    const key = concept.trim();
    if (!byConcept.has(key)) {
      byConcept.set(key, {
        concept: key,
        asked: 0,
        correct: 0,
        incorrect: 0,
        unanswered: 0,
        skipped: 0,
        hintsUsed: 0
      });
    }
    const entry = byConcept.get(key);
    entry.asked += 1;
    if (!row.answered) entry.unanswered += 1;
    else if (row.isCorrect === true) entry.correct += 1;
    else entry.incorrect += 1;
    // Skipping and reaching for a hint are both signals about this concept,
    // independent of whether the answer eventually landed: a question the
    // student skipped past, or only got right after a hint, is not one they
    // have demonstrated. Counted separately rather than folded into `missed`,
    // which stays "did not get this right".
    if (row.skipped === true) entry.skipped += 1;
    if (row.hintViewed === true) entry.hintsUsed += 1;
  }

  return [...byConcept.values()]
    .filter(
      (entry) =>
        entry.incorrect > 0 || entry.unanswered > 0 ||
        // Right, but only after a hint or after skipping past it first — still
        // worth pointing the student at.
        entry.hintsUsed > 0 || entry.skipped > 0
    )
    .map((entry) => ({
      ...entry,
      missed: entry.incorrect + entry.unanswered,
      accuracy: entry.asked === 0 ? 0 : Math.round((entry.correct / entry.asked) * 100)
    }))
    // Most-missed first; ties broken by the weaker accuracy, then by name so
    // the order is stable between identical requests.
    .sort((a, b) => b.missed - a.missed || a.accuracy - b.accuracy || a.concept.localeCompare(b.concept));
};

/**
 * The published material behind the target the student failed to skip.
 *
 * For a topic target that is the topic itself; for a lesson target it is the
 * lesson's topics (or the lesson itself when it has none). Each entry is
 * tagged with the weak concepts whose name matches it, so the student is
 * pointed at the specific topic their wrong answers came from where the
 * course's own naming makes that link available — and at the whole target
 * where it doesn't. No fuzzy matching: an exact, case-insensitive title
 * match, or nothing.
 */
const resolveRecommendedContent = async (target, weakConcepts, tx = null) => {
  const db = tx || prisma;
  const conceptNames = new Set(weakConcepts.map((w) => normalize(w.concept)));

  if (target.kind === "TOPIC") {
    const topic = await db.topic.findUnique({
      where: { id: target.id },
      select: { id: true, title: true, lessonId: true, isPublished: true }
    });
    if (!topic || !topic.isPublished) return [];
    return [
      {
        kind: "TOPIC",
        id: topic.id,
        title: topic.title,
        lessonId: topic.lessonId,
        matchedConcepts: conceptNames.has(normalize(topic.title)) ? [topic.title] : []
      }
    ];
  }

  const lesson = await db.lesson.findUnique({
    where: { id: target.id },
    select: {
      id: true,
      title: true,
      moduleId: true,
      isPublished: true,
      topics: {
        where: { isPublished: true },
        orderBy: { order: "asc" },
        select: { id: true, title: true, lessonId: true }
      }
    }
  });
  if (!lesson || !lesson.isPublished) return [];

  if (lesson.topics.length === 0) {
    return [
      {
        kind: "LESSON",
        id: lesson.id,
        title: lesson.title,
        moduleId: lesson.moduleId,
        matchedConcepts: conceptNames.has(normalize(lesson.title)) ? [lesson.title] : []
      }
    ];
  }

  const topics = lesson.topics.map((topic) => ({
    kind: "TOPIC",
    id: topic.id,
    title: topic.title,
    lessonId: topic.lessonId,
    matchedConcepts: conceptNames.has(normalize(topic.title)) ? [topic.title] : []
  }));

  // When the wrong answers name specific topics in this lesson, those are the
  // recommendation. Otherwise the student has to work through the lesson as
  // it stands, and narrowing it would be inventing a focus the data doesn't
  // support.
  const matched = topics.filter((topic) => topic.matchedConcepts.length > 0);
  return matched.length > 0 ? matched : topics;
};

/**
 * The qualification outcome of one quiz attempt, or null when the quiz isn't
 * a qualifying test.
 *
 * @param {object} quiz     the quiz, including quizTag and its scope columns.
 * @param {object} attempt  the QuizAttempt, with `questionAttempts` included.
 */
/**
 * The target's title, for a result screen that has to name what was — or
 * wasn't — skipped. Read from the lesson/topic itself so it stays correct if
 * the instructor renames it.
 */
const resolveTargetTitle = async (target, tx = null) => {
  const db = tx || prisma;
  const row =
    target.kind === "TOPIC"
      ? await db.topic.findUnique({ where: { id: target.id }, select: { title: true } })
      : await db.lesson.findUnique({ where: { id: target.id }, select: { title: true } });
  return row?.title ?? null;
};

/**
 * The qualification outcome of one quiz attempt, or null when the quiz isn't
 * a qualifying test.
 *
 * @param {object} quiz     the quiz, including quizTag and its scope columns.
 * @param {object} attempt  the QuizAttempt, with `questionAttempts` included.
 * @param {object} tx       optional transaction client.
 * @param {object} context  `allowance` (from buildAttemptAllowance) and
 *   `history` (the attempt summaries) — already computed by the caller, so
 *   the result screen gets "attempt 2 of 3" and the full attempt history
 *   without a second pass over the same rows.
 */
const buildQualificationOutcome = async (quiz, attempt, tx = null, context = {}) => {
  const target = resolveQualificationTarget(quiz);
  if (!target || !attempt) return null;

  const qualified = attempt.passed === true;
  const { allowance = null, history = [] } = context;
  const rows = attempt.questionAttempts || [];
  const answered = rows.filter((r) => r.answered);
  const correct = answered.filter((r) => r.isCorrect === true);

  const outcome = {
    isQualifyingTest: true,
    qualified,
    target: {
      kind: target.kind,
      id: target.id,
      title: await resolveTargetTitle(target, tx)
    },
    passingScore: quiz.passingScore,
    percentage: attempt.percentage,
    score: attempt.score,
    totalMarks: attempt.totalMarks,
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    timeTakenSeconds: attempt.timeTakenSeconds ?? null,
    // Everything the result screen reports about this attempt, folded from
    // the same question records the grade came from. `skipped` is the
    // student's own Skip action; `unanswered` is anything left blank,
    // skipped or not.
    questionBreakdown: {
      total: rows.length,
      correct: correct.length,
      incorrect: answered.length - correct.length,
      skipped: rows.filter((r) => r.skipped === true).length,
      unanswered: rows.length - answered.length
    },
    hintsUsed: rows.filter((r) => r.hintViewed === true).length,
    // Attempt standing, so the screen can say "Attempt 2 of 3" and decide
    // whether to offer another go. The decision is the server's — the client
    // renders it, it does not compute it.
    attemptsUsed: allowance?.attemptsUsed ?? history.length,
    maxAttempts: allowance?.maxAttempts ?? null,
    unlimitedAttempts: allowance?.unlimitedAttempts ?? false,
    attemptsRemaining: allowance?.attemptsRemaining ?? null,
    canRetake: qualified ? false : allowance?.canAttempt === true,
    // Every attempt at THIS target, oldest first and immutable. One quiz per
    // lesson/topic, so the quiz's history is the target's history.
    attempts: history
  };

  if (qualified) {
    // Nothing to recommend: the student demonstrated the knowledge and the
    // target is now theirs to skip. The content itself stays in the course
    // and stays openable — skipped is not deleted.
    return { ...outcome, weakConcepts: [], recommendedContent: [] };
  }

  const weakConcepts = summarizeWeakConcepts(rows);
  const recommendedContent = await resolveRecommendedContent(target, weakConcepts, tx);

  return { ...outcome, weakConcepts, recommendedContent };
};

module.exports = {
  summarizeWeakConcepts,
  resolveRecommendedContent,
  buildQualificationOutcome
};
