/**
 * Authentication secrets that must never leave the API, whoever is asking
 * (admins included): password hashes, reset/verification codes, and the
 * stored hashes of session and device credentials.
 *
 * Many endpoints serialise Prisma rows with `include`, which returns every
 * column of `User`. Rather than trust every query to remember a `select`,
 * every JSON response passes through stripSecrets()
 * (middleware/responseSecrets.middleware.js), the same choke-point approach
 * as the video-source withholding.
 *
 * `refreshToken` is special: POST /auth/login and /auth/google legitimately
 * return the session's refresh credential at the top of `data`. Only the
 * legacy `User.refreshToken` column is a secret, so that key is removed only
 * from objects shaped like a User row (they carry an `email`).
 */

const ALWAYS_SECRET = new Set(["password", "otp", "otpExpiresAt", "tokenHash", "deviceKeyHash"]);
const MAX_DEPTH = 64;

const isPlainObject = (value) => {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isSecretKey = (key, holder) =>
  ALWAYS_SECRET.has(key) || (key === "refreshToken" && Object.prototype.hasOwnProperty.call(holder, "email"));

/** Returns `value` without secret keys; copies only the paths that change. */
function stripSecrets(value, depth = 0) {
  if (depth > MAX_DEPTH) return value;

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = stripSecrets(item, depth + 1);
      if (result !== item) changed = true;
      return result;
    });
    return changed ? next : value;
  }

  if (!isPlainObject(value)) return value;

  let current = value;
  let copied = false;
  for (const [key, child] of Object.entries(value)) {
    if (isSecretKey(key, value)) {
      if (!copied) {
        current = { ...current };
        copied = true;
      }
      delete current[key];
      continue;
    }
    if (child === null || typeof child !== "object") continue;
    const result = stripSecrets(child, depth + 1);
    if (result !== child) {
      if (!copied) {
        current = { ...current };
        copied = true;
      }
      current[key] = result;
    }
  }
  return current;
}

module.exports = { stripSecrets };
