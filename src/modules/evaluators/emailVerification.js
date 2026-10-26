const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const ApiError = require("../../utils/ApiError");

/**
 * Email verification for evaluator registration, done before the account
 * exists so nothing is written to the database for an unverified email.
 *
 * Stateless: sending a code returns a short-lived signed `challenge` that
 * carries only an HMAC of the code (never the code itself). Verifying the
 * code against it returns a `verificationToken`, which /evaluators/register
 * requires for that same email.
 *
 * Both are signed with a key derived from the access-token secret, so neither
 * can ever pass as a session token (and a session token can't pass as these).
 */

const OTP_VALID_MS = 10 * 60 * 1000;
const VERIFIED_VALID_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const CHALLENGE = "evaluator-email-otp";
const VERIFIED = "evaluator-email-verified";

const signingKey = () => {
  const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_ACCESS_SECRET is not configured");
  return crypto.createHmac("sha256", secret).update("evaluator-email-verification").digest();
};

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const codeDigest = (email, otp, nonce) =>
  crypto.createHmac("sha256", signingKey()).update(`${normalizeEmail(email)}:${nonce}:${otp}`).digest("hex");

const sameDigest = (a, b) => {
  const left = Buffer.from(String(a), "hex");
  const right = Buffer.from(String(b), "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const readToken = (token, purpose, invalidMessage, code) => {
  try {
    const payload = jwt.verify(String(token || ""), signingKey(), { algorithms: ["HS256"] });
    if (payload.purpose !== purpose) throw new Error("wrong purpose");
    return payload;
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new ApiError(400, "This code has expired. Please request a new one.", `${code}_EXPIRED`);
    }
    throw new ApiError(400, invalidMessage, `${code}_INVALID`);
  }
};

// Wrong guesses per challenge. In memory only (it is not account data): a
// restart or another instance merely gives a challenge a few more tries,
// which the route's rate limit still bounds.
const attempts = new Map();

const countAttempt = (nonce, expiresAtMs) => {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.expiresAtMs <= now) attempts.delete(key);
  const entry = attempts.get(nonce) || { count: 0, expiresAtMs };
  entry.count += 1;
  attempts.set(nonce, entry);
  return entry.count;
};

/** A fresh code and the challenge that proves it was issued for `email`. */
const issueCode = (email) => {
  const otp = crypto.randomInt(100000, 1000000).toString();
  const nonce = crypto.randomUUID();
  const challenge = jwt.sign(
    { purpose: CHALLENGE, email: normalizeEmail(email), nonce, digest: codeDigest(email, otp, nonce) },
    signingKey(),
    { algorithm: "HS256", expiresIn: Math.floor(OTP_VALID_MS / 1000) }
  );
  return { otp, challenge, expiresAt: new Date(Date.now() + OTP_VALID_MS) };
};

/** Checks `otp` against the challenge; returns the verification token. */
const verifyCode = (email, otp, challenge) => {
  const payload = readToken(challenge, CHALLENGE, "This code is no longer valid. Please request a new one.", "EMAIL_OTP");
  if (payload.email !== normalizeEmail(email)) {
    throw new ApiError(400, "This code was sent to a different email address.", "EMAIL_OTP_INVALID");
  }

  const entry = attempts.get(payload.nonce);
  if (entry?.used) {
    throw new ApiError(400, "This code has already been used. Please request a new one.", "EMAIL_OTP_USED");
  }
  if ((entry?.count || 0) >= MAX_ATTEMPTS) {
    throw new ApiError(429, "Too many wrong codes. Please request a new one.", "EMAIL_OTP_LOCKED");
  }
  if (!sameDigest(codeDigest(email, String(otp), payload.nonce), payload.digest)) {
    const count = countAttempt(payload.nonce, payload.exp * 1000);
    throw new ApiError(
      400,
      count >= MAX_ATTEMPTS ? "Too many wrong codes. Please request a new one." : "Incorrect code. Please try again.",
      count >= MAX_ATTEMPTS ? "EMAIL_OTP_LOCKED" : "EMAIL_OTP_WRONG"
    );
  }
  // One successful use per challenge.
  attempts.set(payload.nonce, { count: entry?.count || 0, used: true, expiresAtMs: payload.exp * 1000 });

  const verificationToken = jwt.sign({ purpose: VERIFIED, email: payload.email }, signingKey(), {
    algorithm: "HS256",
    expiresIn: Math.floor(VERIFIED_VALID_MS / 1000),
  });
  return { verificationToken, expiresAt: new Date(Date.now() + VERIFIED_VALID_MS) };
};

/** Throws unless `token` proves `email` was verified. */
const assertVerified = (email, token) => {
  const payload = readToken(
    token,
    VERIFIED,
    "Please verify your email address before creating the account.",
    "EMAIL_NOT_VERIFIED"
  );
  if (payload.email !== normalizeEmail(email)) {
    throw new ApiError(400, "Please verify this email address before creating the account.", "EMAIL_NOT_VERIFIED_INVALID");
  }
};

module.exports = { OTP_VALID_MS, MAX_ATTEMPTS, issueCode, verifyCode, assertVerified };
