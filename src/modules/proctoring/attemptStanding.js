const prisma = require("../../config/database");

/**
 * Small reads about a student's proctored attempts that the quiz and playback
 * services need. Only ever called for a quiz that is or was proctored, or while the feature is on.
 * Depends on nothing but the database, so those services can require it freely.
 */

const OPEN_STATUSES = ["PREPARING", "IN_PROGRESS"];
const APPEAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Whether students may have proctored attempts on a quiz, now or from before an instructor
 * switched it off. proctoringSetAt is written on every change of the setting and never
 * cleared, so a quiz that was never ticked is false and runs no proctoring query.
 */
const wasEverProctored = (quiz) => Boolean(quiz?.proctoringEnabled || quiz?.proctoringSetAt);

/** Whether a decision can still be asked about: within 30 days, and not one the student already has in their favour. */
const canStillAppeal = (attempt, now = new Date()) =>
  attempt.reviewState === "DECIDED" && Boolean(attempt.decidedAt) && attempt.decision !== "ACCEPT" && now.getTime() - attempt.decidedAt.getTime() < APPEAL_WINDOW_MS;

/** How an attempt reads to its student. Why it was flagged stays with the reviewer. */
function studentOutcome(attempt) {
  if (attempt.status === "TERMINATED") return "ENDED_BY_PROCTORING";
  if (attempt.reviewState === "PENDING") return "UNDER_REVIEW";
  if (attempt.decision === "VOID") return "VOIDED";
  if (attempt.decision === "RETAKE") return "RETAKE_ALLOWED";
  return "SCORED";
}

/** The label for the LMS result screen, for one recorded attempt. */
async function proctoredResultLabel(quizAttemptId) {
  const attempt = await prisma.proctoredAttempt.findUnique({
    where: { quizAttemptId },
    select: { id: true, status: true, reviewState: true, decision: true },
  });
  return attempt ? { attemptId: attempt.id, outcome: studentOutcome(attempt) } : null;
}

/**
 * Whether this student chose to take this proctored quiz without proctoring. Final for the
 * quiz: it is then an ordinary quiz for them (questions, submit and results as usual).
 */
const hasOptedOut = async (studentId, quizId, client = prisma) =>
  Boolean(
    studentId &&
      quizId &&
      (await client.proctoringOptOut.findUnique({ where: { studentId_quizId: { studentId, quizId } }, select: { id: true } }))
  );

/** Approved retakes on a proctored quiz, used or not. Each adds one attempt, on either route. */
const retakeGrantCount = (studentId, quizId, client = prisma) =>
  studentId && quizId ? client.proctoringRetakeGrant.count({ where: { studentId, quizId } }) : 0;

/** An attempt limit raised by approved retakes. 0 means unlimited and stays unlimited. */
const withRetakes = (maxAttempts, grants) => (maxAttempts > 0 ? maxAttempts + grants : 0);

const isExamInProgress = async (userId) =>
  Boolean(await prisma.proctoredAttempt.findFirst({ where: { userId, status: "IN_PROGRESS" }, select: { id: true } }));

/**
 * What a proctored quiz's result may show. The answer key stays back while the
 * outcome can still change: a review is open, an unused retake exists, or a
 * decision can still be appealed.
 */
async function resultStanding(studentId, quizId, now = new Date()) {
  const [attempts, unusedGrant] = await Promise.all([
    prisma.proctoredAttempt.findMany({
      where: { studentId, quizId },
      select: { status: true, reviewState: true, decidedAt: true },
    }),
    prisma.proctoringRetakeGrant.findFirst({ where: { studentId, quizId, usedAt: null }, select: { id: true } }),
  ]);
  const appealable = (attempt) => attempt.decidedAt && now.getTime() - attempt.decidedAt.getTime() < APPEAL_WINDOW_MS;
  return {
    examInProgress: attempts.some((attempt) => attempt.status === "IN_PROGRESS"),
    holdAnswerKey:
      Boolean(unusedGrant) ||
      attempts.some((attempt) => OPEN_STATUSES.includes(attempt.status) || attempt.reviewState === "PENDING" || appealable(attempt)),
  };
}

module.exports = { OPEN_STATUSES, APPEAL_WINDOW_MS, canStillAppeal, hasOptedOut, isExamInProgress, proctoredResultLabel, resultStanding, retakeGrantCount, studentOutcome, wasEverProctored, withRetakes };
