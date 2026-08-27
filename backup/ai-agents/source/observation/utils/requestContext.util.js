const crypto = require("crypto");

/**
 * Extracts IP/user-agent from an Express request. Trusts req.ip, which
 * Express derives from X-Forwarded-For only when `trust proxy` is set —
 * this repo doesn't set it, so behind a proxy this will reflect the
 * proxy's address rather than the client's real IP. Acceptable for now;
 * revisit alongside CDN/proxy setup.
 */
const extractRequestContext = (req) => ({
  ipAddress: req.ip || req.socket?.remoteAddress || null,
  userAgent: req.headers?.["user-agent"] || null,
});

/**
 * Generates a session id for events that don't supply one (e.g. a single
 * fire-and-forget navigation ping). Callers that want events grouped into
 * a real session (video playback, a quiz attempt) should pass their own
 * sessionId explicitly.
 */
const generateSessionId = () => `sess_${crypto.randomUUID()}`;

module.exports = {
  extractRequestContext,
  generateSessionId,
};
