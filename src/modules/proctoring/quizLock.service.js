const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const { isProctoringAvailable, MAX_PROCTORED_MINUTES } = require("../../config/proctoring");
const { AUDIT_EVENTS, recordAuditEvent } = require("../audit/audit.service");

/**
 * The rules around Quiz.proctoringEnabled: which quizzes may have it, and what
 * locks once a student has started a readiness check.
 *
 * A quiz without the checkbox runs none of the queries here on its normal paths,
 * so it behaves exactly as it did before proctoring existed.
 */

const LOCKED_MESSAGE =
  "This quiz is proctored and a student has started it, so its proctoring setting, tag, time limit and questions can no longer change.";

const locked = (message = LOCKED_MESSAGE) => new ApiError(409, message, "PROCTORING_LOCKED");

/** A proctored quiz must be graded and timed. Throws when the effective values do not qualify. */
function assertEligible({ quizTag, timeLimit }) {
  if (quizTag === "SELF_TEST") {
    throw new ApiError(400, "A Self-Test cannot be proctored.", "PROCTORING_NOT_ALLOWED_ON_SELF_TEST");
  }
  if (!(Number(timeLimit) > 0)) {
    throw new ApiError(400, "A proctored quiz needs a time limit.", "PROCTORING_REQUIRES_TIME_LIMIT");
  }
  if (Number(timeLimit) > MAX_PROCTORED_MINUTES) {
    throw new ApiError(400, `A proctored quiz can be at most ${MAX_PROCTORED_MINUTES} minutes.`, "PROCTORING_TIME_LIMIT_TOO_LONG");
  }
}

function assertAvailable() {
  if (!isProctoringAvailable()) {
    throw new ApiError(403, "Proctoring is not available.", "PROCTORING_NOT_AVAILABLE");
  }
}

/** The row fields and audit entry for a quiz created with the box ticked. */
function fieldsForCreate(data, userId) {
  if (data.proctoringEnabled !== true) return {};
  assertAvailable();
  assertEligible({ quizTag: data.quizTag, timeLimit: data.timeLimit });
  return { proctoringEnabled: true, proctoringSetById: userId, proctoringSetAt: new Date() };
}

const recordSettingChange = (client, { userId, quizId, enabled }) =>
  recordAuditEvent(
    { userId, eventType: AUDIT_EVENTS.PROCTORING_SETTING_CHANGED, metadata: { quizId, enabled } },
    { client }
  );

const proctoredAttemptExists = async (client, quizId) =>
  Boolean(await client.proctoredAttempt.findFirst({ where: { quizId }, select: { id: true } }));

/** Attempts of any kind, proctored or not: a quiz students have already sat cannot be ticked. */
const anyAttemptExists = async (client, quizId) => {
  const [proctored, attempt, submission] = await Promise.all([
    proctoredAttemptExists(client, quizId),
    client.quizAttempt.findFirst({ where: { quizId }, select: { id: true } }),
    client.quizSubmission.findFirst({ where: { quizId }, select: { id: true } }),
  ]);
  return proctored || Boolean(attempt) || Boolean(submission);
};

const lockQuizRow = (client, quizId) => client.$queryRaw`SELECT "id" FROM "Quiz" WHERE "id" = ${quizId} FOR UPDATE`;

/**
 * Inside updateQuiz's transaction. Returns the extra row fields (empty when the
 * setting does not change). Does nothing at all for an unticked quiz that is not
 * being ticked.
 */
async function resolveUpdate(tx, existing, { proctoringEnabled, quizData, questionsSent, userId }) {
  const askedToTick = proctoringEnabled === true && !existing.proctoringEnabled;
  if (!existing.proctoringEnabled && !askedToTick) return {};

  await lockQuizRow(tx, existing.id);

  const effectiveEnabled = proctoringEnabled ?? existing.proctoringEnabled;
  const settingChanges = effectiveEnabled !== existing.proctoringEnabled;
  const effectiveTag = quizData.quizTag ?? existing.quizTag;
  const timeLimitSent = Object.prototype.hasOwnProperty.call(quizData, "timeLimit");
  const effectiveTimeLimit = timeLimitSent ? quizData.timeLimit : existing.timeLimit;

  if (existing.proctoringEnabled) {
    const tagChanges = effectiveTag !== existing.quizTag;
    const timeChanges = (effectiveTimeLimit ?? null) !== (existing.timeLimit ?? null);
    if ((settingChanges || tagChanges || timeChanges || questionsSent) && (await proctoredAttemptExists(tx, existing.id))) {
      throw locked();
    }
  } else if (await anyAttemptExists(tx, existing.id)) {
    throw locked("Students have already attempted this quiz, so it cannot be proctored now.");
  }

  if (askedToTick) assertAvailable();
  if (effectiveEnabled) assertEligible({ quizTag: effectiveTag, timeLimit: effectiveTimeLimit });
  if (!settingChanges) return {};

  await recordSettingChange(tx, { userId, quizId: existing.id, enabled: effectiveEnabled });
  return { proctoringEnabled: effectiveEnabled, proctoringSetById: userId, proctoringSetAt: new Date() };
}

/** Refuses a change to a quiz's question set once a proctored attempt exists. */
async function assertQuizQuestionsUnlocked(quizId) {
  if (!quizId) return;
  const quiz = await prisma.quiz.findFirst({
    where: { id: quizId, proctoringEnabled: true, proctoredAttempts: { some: {} } },
    select: { id: true },
  });
  if (quiz) throw locked();
}

/** Refuses a change to a shared question-bank row used by a locked quiz. */
async function assertQuestionUnlocked(questionId) {
  const link = await prisma.quizQuestion.findFirst({
    where: { questionId, quiz: { proctoringEnabled: true, proctoredAttempts: { some: {} } } },
    select: { quiz: { select: { title: true } } },
  });
  if (link) {
    throw locked(`This question is used by the proctored quiz "${link.quiz.title}", which a student has started, so it can no longer change.`);
  }
}

/** Whether the instructor screens should show the setting as locked. */
const isQuizLocked = (quizId) => proctoredAttemptExists(prisma, quizId);

module.exports = {
  assertEligible,
  assertAvailable,
  assertQuestionUnlocked,
  assertQuizQuestionsUnlocked,
  fieldsForCreate,
  isQuizLocked,
  recordSettingChange,
  resolveUpdate,
};
