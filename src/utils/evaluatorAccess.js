const prisma = require("../config/database");

/**
 * Evaluator (guest tester) access — see src/modules/evaluators.
 *
 * An evaluator is an ordinary user with an EvaluatorAccess row. Access is
 * fixed at registration: expiresAt = startsAt + 48h, both written once by the
 * server and never reset. During the period the evaluator has full learning
 * access (feedback is asked for, not required); when it ends, learning access
 * closes and the evaluator is asked for the external feedback if it is not
 * yet verified.
 *
 * verifyToken calls this on every authenticated request, so the row is cached
 * briefly. Only the row is cached — the decision is recomputed against the
 * clock each time, so expiry takes effect to the millisecond. A feedback
 * confirmation in this process drops the entry at once; another instance
 * catches up within the TTL.
 */

const EVALUATOR_ACCESS_MS = 48 * 60 * 60 * 1000;

const EVALUATOR_STATES = {
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
};

const BLOCK_CODES = {
  EXPIRED: "EVALUATOR_ACCESS_EXPIRED",
};

const expiryFor = (startsAt) => new Date(new Date(startsAt).getTime() + EVALUATOR_ACCESS_MS);

/** The access decision for one EvaluatorAccess row at time `now`. */
const evaluatorState = (access, now = Date.now()) => {
  const feedbackCompleted = Boolean(access.feedbackCompletedAt);
  const expired = now >= new Date(access.expiresAt).getTime();
  return { state: expired ? EVALUATOR_STATES.EXPIRED : EVALUATOR_STATES.ACTIVE, feedbackCompleted };
};

// Reachable after expiry: sign-in/out, the profile that tells the client
// which screen to show, and the evaluator endpoints themselves (status and
// the feedback check, which stays open after the deadline). Everything else that needs a session is learning
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

  return {
    status: 403,
    body: {
      success: false,
      code: BLOCK_CODES.EXPIRED,
      message: "Your evaluator testing period has ended.",
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
