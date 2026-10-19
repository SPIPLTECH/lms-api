const crypto = require("crypto");
const prisma = require("../config/database");

/**
 * Session versioning: every access/refresh token carries `pv`, a short
 * fingerprint of the user's password hash at the time it was issued. Changing
 * or resetting the password changes the hash, so every token issued before it
 * — i.e. every other browser's session — stops verifying.
 *
 * The fingerprint is one-way and truncated: it identifies a hash, it does not
 * reveal one.
 */
const passwordFingerprint = (passwordHash) =>
  crypto.createHash("sha256").update(String(passwordHash || "")).digest("base64url").slice(0, 16);

// verifyToken runs on every request and the database is remote, so the
// current fingerprint is cached briefly. A password change in this process
// drops the entry at once; another instance catches up within the TTL.
const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

/** The session could not be checked (database unreachable) — not a bad token. */
class SessionCheckUnavailable extends Error {
  constructor(cause) {
    super("Session check unavailable");
    this.name = "SessionCheckUnavailable";
    this.cause = cause;
  }
}

const currentFingerprint = async (userId) => {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.fingerprint;

  let user;
  try {
    user = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
  } catch (error) {
    // A database blip must not sign everyone out: fall back to the last known
    // value, else surface it as unavailable (see SessionCheckUnavailable).
    if (hit) return hit.fingerprint;
    throw new SessionCheckUnavailable(error);
  }
  const fingerprint = user ? passwordFingerprint(user.password) : null;
  cache.set(userId, { fingerprint, expiresAt: Date.now() + CACHE_TTL_MS });
  return fingerprint;
};

/**
 * True when a decoded token still belongs to the user's current password.
 * A token without `pv` (issued before session versioning) is not current: the
 * client's normal refresh-on-401 flow swaps it for one that has it.
 */
const isSessionCurrent = async (decoded) => {
  if (!decoded?.id || !decoded.pv) return false;
  const fingerprint = await currentFingerprint(decoded.id);
  return fingerprint !== null && fingerprint === decoded.pv;
};

const forgetSession = (userId) => cache.delete(userId);

module.exports = { passwordFingerprint, isSessionCurrent, forgetSession, SessionCheckUnavailable };
