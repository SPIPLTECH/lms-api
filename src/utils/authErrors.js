const ApiError = require("./ApiError");

/**
 * Stable error codes for sign-in, sessions and playback. Clients branch on
 * `code`; the message is for people and may change.
 *
 * Every response built here keeps this API's existing top-level
 * `{ success: false, message, code }` shape — the frontend reads
 * `response.data.message` everywhere — and adds the specification's
 * `error: { code, message, requestId }` object alongside it.
 */
const AUTH_ERRORS = {
  AUTH_REQUIRED: { status: 401, message: "Token required" },
  ACCESS_TOKEN_EXPIRED: { status: 401, message: "Token expired" },
  SESSION_INVALID: { status: 401, message: "Your session is no longer valid. Please sign in again." },
  SESSION_EXPIRED: { status: 401, message: "Your session expired. Please sign in again." },
  // Signing in on another device is allowed for every role; this is only a
  // simultaneous second sign-in from the same browser (or, before
  // scripts/auth-sessions-per-device.sql is applied, the old per-user index —
  // session.service.js sends its own message for that).
  SESSION_ALREADY_ACTIVE: {
    status: 409,
    message: "This browser is already signing in. Please wait a moment and try again.",
  },
  ACCOUNT_SUSPENDED: { status: 403, message: "Your account has been suspended. Please contact support." },
  ACCOUNT_NOT_ALLOWED: { status: 403, message: "No Orange Tree LMS account is linked to this Google account." },
  GOOGLE_TOKEN_INVALID: { status: 401, message: "Google sign-in could not be verified. Please try again." },
  GOOGLE_AUTH_NOT_CONFIGURED: { status: 503, message: "Google sign-in is not available right now." },
  PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE: {
    status: 409,
    message: "This account is already watching on another device. Stop playback on that device to continue watching here.",
  },
  PLAYBACK_LEASE_LOST: { status: 409, message: "Playback permission expired. Pause and try again." },
  PROCTORED_EXAM_IN_PROGRESS: { status: 409, message: "You have a proctored exam in progress. Finish it before watching videos." },
  // A STUDENT device asked for course content while another device of the
  // same account holds the playback lease (middleware/contentAccess.middleware.js).
  CONTENT_ACTIVE_ON_ANOTHER_DEVICE: {
    status: 409,
    message: "This account is currently active on another device. Stop playback on that device to access course content here.",
  },
  CONTENT_ACCESS_DENIED: { status: 403, message: "You do not have access to this content." },
  CONTENT_NOT_PLAYABLE: { status: 400, message: "This item is not a video." },
  MEDIA_UNAVAILABLE: { status: 404, message: "This video is not available." },
  MEDIA_URL_INVALID: { status: 403, message: "This video link has expired. Reload the lesson to keep watching." },
  LOGOUT_FAILED: {
    status: 503,
    message: "We couldn't sign you out because the server didn't respond. Check your connection and try again.",
  },
};

/** An ApiError carrying one of the codes above (message overridable). */
const authError = (code, message) => {
  const spec = AUTH_ERRORS[code];
  if (!spec) throw new Error(`Unknown auth error code: ${code}`);
  return new ApiError(spec.status, message || spec.message, code);
};

// Upper-snake-case words only (SESSION_EXPIRED, NOT_FOUND): Prisma's
// "P2002"-style codes are internal and are not promoted to the public
// `error` object.
const isPublicErrorCode = (code) => typeof code === "string" && /^[A-Z]+(?:_[A-Z0-9]+)+$/.test(code);

const errorBody = (req, code, message) => ({
  success: false,
  message,
  code,
  error: { code, message, requestId: req?.requestId },
});

/** Writes an auth error directly (for middleware that answers without next()). */
const sendAuthError = (req, res, codeOrError) => {
  const error = typeof codeOrError === "string" ? authError(codeOrError) : codeOrError;
  return res.status(error.statusCode).json(errorBody(req, error.code, error.message));
};

module.exports = {
  AUTH_ERRORS,
  authError,
  errorBody,
  sendAuthError,
  isPublicErrorCode,
};
