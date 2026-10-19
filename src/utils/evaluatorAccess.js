const prisma = require("../config/database");

/**
 * Evaluator (guest tester) access — see src/modules/evaluators.
 *
 * An evaluator is an ordinary user with an EvaluatorAccess row. Access is
 * fixed at registration: expiresAt = startsAt + 48h, both written once by the
 * server and never reset. While the period is active the evaluator must first
 * have verified external feedback; after it ends, learning access is closed
 * whatever the feedback status.
 *
 * verifyToken calls this on every authenticated request, so the row is cached
 * briefly. Only the row is cached — the decision is recomputed against the
 * clock each time, so expiry takes effect to the millisecond. A feedback
 * confirmation in this process drops the entry at once; another instance
 * catches up within the TTL.
 */

const EVALUATOR_ACCESS_MS = 48 * 60 * 60 * 1000;

const EVALUATOR_STATES = {
  FEEDBACK_REQUIRED: "FEEDBACK_REQUIRED",
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
};

const BLOCK_CODES = {
  FEEDBACK_REQUIRED: "EVALUATOR_FEEDBACK_REQUIRED",
  EXPIRED: "EVALUATOR_ACCESS_EXPIRED",
};

const expiryFor = (startsAt) => new Date(new Date(startsAt).getTime() + EVALUATOR_ACCESS_MS);

/** The access decision for one EvaluatorAccess row at time `now`. */
const evaluatorState = (access, now = Date.now()) => {
  const feedbackCompleted = Boolean(access.feedbackCompletedAt);
  if (now >= new Date(access.expiresAt).getTime()) {
    return { state: EVALUATOR_STATES.EXPIRED, feedbackCompleted };
  }
  return {
    state: feedbackCompleted ? EVALUATOR_STATES.ACTIVE : EVALUATOR_STATES.FEEDBACK_REQUIRED,
    feedbackCompleted,
  };
};

// Reachable while blocked: sign-in/out, the profile that tells the client
// which screen to show, and the evaluator endpoints themselves (status and
// the feedback check). Everything else that needs a session is learning
// access and is refused.
const ALWAYS_ALLOWED_PREFIXES = ["/auth/", "/evaluators/"];

const isAlwaysAllowedPath = (originalUrl = "") => {
  const path = originalUrl.split("?")[0];
  return ALWAYS_ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
};

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();
let missingTableWarned = false;

const loadAccess = async (userId) => {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.access;

  // Deployed before `prisma generate` / the schema script: behave as if the
  // feature did not exist rather than failing every request.
  if (!prisma.evaluatorAccess) return null;

  let access;
  try {
    access = await prisma.evaluatorAccess.findUnique({ where: { userId } });
  } catch (error) {
    if (error.code === "P2021") {
      if (!missingTableWarned) {
        console.warn("EvaluatorAccess table missing; run scripts/evaluator-access-schema.sql");
        missingTableWarned = true;
      }
      return null;
    }
    // Same policy as utils/sessionVersion: a database blip falls back to the
    // last known row; with nothing cached, the caller's error handling decides.
    if (hit) return hit.access;
    throw error;
  }
  cache.set(userId, { access, expiresAt: Date.now() + CACHE_TTL_MS });
  return access;
};

/**
 * Null when the request may proceed; otherwise `{ status, body }` to send.
 * Non-evaluators always proceed.
 */
const evaluatorBlock = async (userId, originalUrl) => {
  if (!userId || isAlwaysAllowedPath(originalUrl)) return null;
  const access = await loadAccess(userId);
  if (!access) return null;

  const { state, feedbackCompleted } = evaluatorState(access);
  if (state === EVALUATOR_STATES.ACTIVE) return null;

  const expired = state === EVALUATOR_STATES.EXPIRED;
  return {
    status: 403,
    body: {
      success: false,
      code: expired ? BLOCK_CODES.EXPIRED : BLOCK_CODES.FEEDBACK_REQUIRED,
      message: expired
        ? "Your evaluator testing period has ended."
        : "Please complete the evaluation feedback form to continue.",
      data: { state, feedbackCompleted, expiresAt: access.expiresAt },
    },
  };
};

const forgetEvaluatorAccess = (userId) => cache.delete(userId);

// StudentProfile id -> User id never changes, so it is cached for good.
const userIdByStudentId = new Map();

/**
 * True when this StudentProfile belongs to an evaluator account. Used to open
 * every step of the learning sequence for evaluators (utils/learningSequence
 * `unlockAll`): they test the whole course, not one item at a time. Only
 * active evaluators get this far — verifyToken refuses the rest. Any failure
 * answers false, which keeps the normal locks.
 */
const isEvaluatorStudent = async (studentProfileId) => {
  if (!studentProfileId) return false;
  try {
    let userId = userIdByStudentId.get(studentProfileId);
    if (!userId) {
      const profile = await prisma.studentProfile.findUnique({
        where: { id: studentProfileId },
        select: { userId: true },
      });
      if (!profile) return false;
      userId = profile.userId;
      userIdByStudentId.set(studentProfileId, userId);
    }
    return Boolean(await loadAccess(userId));
  } catch {
    return false;
  }
};

module.exports = {
  EVALUATOR_ACCESS_MS,
  EVALUATOR_STATES,
  BLOCK_CODES,
  expiryFor,
  evaluatorState,
  isAlwaysAllowedPath,
  loadAccess,
  evaluatorBlock,
  forgetEvaluatorAccess,
  isEvaluatorStudent,
};
