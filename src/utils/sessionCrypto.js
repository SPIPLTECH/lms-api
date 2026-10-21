const crypto = require("crypto");

/**
 * Opaque credentials for sessions and devices. Only SHA-256 digests are ever
 * stored; the raw values exist in the response that issues them and in the
 * client, nowhere else (never logged).
 */

/** A URL-safe random secret: 32 bytes -> 43 chars, 48 bytes -> 64 chars. */
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");

const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

// What randomToken() produces. Anything else is not one of our credentials,
// so it is rejected before it is hashed or looked up.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const isWellFormedToken = (value) => typeof value === "string" && TOKEN_PATTERN.test(value);

/** Constant-time comparison of two hex digests. */
const digestsEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

module.exports = {
  randomToken,
  sha256,
  isWellFormedToken,
  digestsEqual,
};
