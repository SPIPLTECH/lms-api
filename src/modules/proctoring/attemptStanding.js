const prisma = require("../../config/database");

/**
 * Small reads about a student's proctored attempts that the quiz and playback
 * services need. Only ever called for a proctored quiz, or while the feature is on.
 * Depends on nothing but the database, so those services can require it freely.
 */

const OPEN_STATUSES = ["PREPARING", "IN_PROGRESS"];
const APPEAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

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

module.exports = { OPEN_STATUSES, APPEAL_WINDOW_MS, canStillAppeal, isExamInProgress, proctoredResultLabel, resultStanding, studentOutcome };
