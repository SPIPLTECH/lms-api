const prisma = require("../../config/database");
const ApiError = require("../../utils/ApiError");
const { isProctoringAvailable, MAX_PROCTORED_MINUTES } = require("../../config/proctoring");
const { AUDIT_EVENTS, recordAuditEvent } = require("../audit/audit.service");

/**
 * The rules around Quiz.proctoringEnabled: which quizzes may have it, and what
 * locks once a student has started a readiness check.
 *
 * The checkbox itself can be switched off and on at any time. While it is on and a
 * student has started, the tag, time limit and questions are fixed. Switched off, the
 * quiz is an ordinary quiz again; exams already under way finish as they began, and
 * past proctored attempts keep their standing (see attemptStanding.wasEverProctored).
 *
 * A quiz without the checkbox runs none of the queries here on its normal paths,
 * so it behaves exactly as it did before proctoring existed.
 */

const LOCKED_MESSAGE =
  "This quiz is proctored and a student has started it, so its tag, time limit and questions can no longer change. Switch proctoring off first to change them.";

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

  // Only a quiz that stays proctored is held still; switching it off is always allowed.
  if (existing.proctoringEnabled && effectiveEnabled) {
    const tagChanges = effectiveTag !== existing.quizTag;
    const timeChanges = (effectiveTimeLimit ?? null) !== (existing.timeLimit ?? null);
    if ((tagChanges || timeChanges || questionsSent) && (await proctoredAttemptExists(tx, existing.id))) {
      throw locked();
    }
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
