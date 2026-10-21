const jwt = require("jsonwebtoken");

const sessionService = require("../modules/sessions/session.service");
const { authError, sendAuthError } = require("../utils/authErrors");

/**
 * Authentication for protected routes.
 *
 * The Bearer access token is a short-lived JWT naming a session (`sid`). Its
 * signature and expiry are checked first (cheap, no I/O), then the session
 * row is checked on EVERY request: ACTIVE, inside its idle and absolute
 * deadlines, presented from the device it is bound to (X-Device-Key), and
 * belonging to an ACTIVE account. A token stays valid only while its session
 * does — logout, expiry, revocation and suspension take effect immediately.
 *
 * 401 responses carry a stable `code` so the client can tell a refreshable
 * access-token expiry (ACCESS_TOKEN_EXPIRED) from a dead session
 * (SESSION_EXPIRED / SESSION_INVALID), which no refresh can revive.
 */

const ACCESS_SECRET = () => process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;

const bearerToken = (req) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.split(" ")[1] || null;
};

/** Resolves the request's session into req.user, or throws an auth ApiError. */
const authenticate = async (req, token) => {
  let decoded;
  try {
    decoded = jwt.verify(token, ACCESS_SECRET());
  } catch (error) {
    throw authError(error.name === "TokenExpiredError" ? "ACCESS_TOKEN_EXPIRED" : "SESSION_INVALID");
  }

  // Tokens issued before sessions existed name none: their holder must sign
  // in again.
  if (!decoded.sid) throw authError("SESSION_INVALID");

  const session = await sessionService.validateAccess({
    sessionId: decoded.sid,
    userId: decoded.id,
    deviceKey: req.get("x-device-key"),
  });

  return {
    id: decoded.id,
    email: decoded.email,
    role: decoded.role,
    sessionId: session.id,
    deviceId: session.deviceId,
  };
};

// Auth failures carry a status and one of the stable codes; anything else
// (a database outage) is a server error, not a reason to log the user out.
const isAuthFailure = (error) => Boolean(error?.statusCode && error?.code);

const verifyToken = async (req, res, next) => {
  const token = bearerToken(req);
  if (!token) return sendAuthError(req, res, "AUTH_REQUIRED");

  try {
    req.user = await authenticate(req, token);
  } catch (error) {
    if (isAuthFailure(error)) return sendAuthError(req, res, error);
    return next(error);
  }
  return next();
};

/**
 * For routes that serve guests too. No token, or any token that does not
 * resolve to a valid session, is treated as GUEST — never as the user the
 * token claims to be.
 *
 * A failure to check the session (database unavailable) also falls back to
 * GUEST: the least privilege, so it is safe, and public pages keep working
 * instead of turning into 500s.
 */
const optionalToken = async (req, res, next) => {
  const token = bearerToken(req);
  if (!token) {
    req.user = { role: "GUEST" };
    return next();
  }

  try {
    req.user = await authenticate(req, token);
  } catch (error) {
    if (!isAuthFailure(error)) {
      console.warn("[auth] session check failed on a public route; serving as guest:", error?.message);
    }
    req.user = { role: "GUEST" };
  }
  return next();
};

module.exports = verifyToken;
module.exports.verifyToken = verifyToken;
module.exports.optionalToken = optionalToken;
module.exports.authenticate = authenticate;
