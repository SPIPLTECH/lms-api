const jwt = require("jsonwebtoken");

/**
 * The token a student's exam page sends with frames and events. Checked in memory,
 * with no session query, so the frame path costs the database nothing. It names
 * one attempt and one tokenVersion: resuming raises the version, which stops the
 * previous tab or device. It is never stored and never goes in a URL.
 */

const ISSUER = "orange-tree-proctoring";
const PREPARING_TTL_SECONDS = 45 * 60;
const AFTER_DEADLINE_SECONDS = 5 * 60;

const secret = (env = process.env) => env.PROCTORING_TOKEN_SECRET || "";
const isTokenSecretConfigured = (env = process.env) => secret(env).length > 0;

function signMonitorToken(attempt, now = new Date()) {
  const expiresAt = attempt.deadlineAt
    ? Math.floor(attempt.deadlineAt.getTime() / 1000) + AFTER_DEADLINE_SECONDS
    : Math.floor(now.getTime() / 1000) + PREPARING_TTL_SECONDS;
  return jwt.sign({ aid: attempt.id, v: attempt.tokenVersion, exp: expiresAt }, secret(), { algorithm: "HS256", issuer: ISSUER });
}

/** The attempt and version a token names, or null when it is not valid. */
function verifyMonitorToken(token) {
  if (!token || !isTokenSecretConfigured()) return null;
  try {
    const { aid, v } = jwt.verify(token, secret(), { algorithms: ["HS256"], issuer: ISSUER });
    return { attemptId: aid, version: v };
  } catch {
    return null;
  }
}

module.exports = { isTokenSecretConfigured, signMonitorToken, verifyMonitorToken };
