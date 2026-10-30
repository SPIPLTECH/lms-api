const { OAuth2Client } = require("google-auth-library");

const { authError } = require("../../utils/authErrors");

/**
 * Server-side verification of a Google ID token (the `credential` that
 * Google Identity Services hands the browser).
 *
 * google-auth-library's verifyIdToken checks the RS256 signature against
 * Google's published certificates (fetched and cached by the library), the
 * issuer (accounts.google.com / https://accounts.google.com), the audience
 * (our OAuth client id(s), GOOGLE_CLIENT_ID — comma-separated if there are
 * several), and the iat/exp window. Nothing the browser says about the user
 * is trusted; the identity is what the verified token says.
 *
 * The stable identity key is (issuer, sub). Both Google issuer spellings are
 * normalised to one value so the same account always maps to the same key.
 */

const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

const configuredAudiences = () =>
  (process.env.GOOGLE_CLIENT_ID || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

let sharedClient = null;
const defaultClient = () => {
  if (!sharedClient) sharedClient = new OAuth2Client();
  return sharedClient;
};

/**
 * @param {string} idToken
 * @param {{ client?: OAuth2Client, audiences?: string[] }} [options]
 *   `client` / `audiences` exist for tests; production uses the env config.
 * @returns {Promise<{ issuer, subject, email: string|null, emailVerified: boolean }>}
 */
async function verifyGoogleIdToken(idToken, { client = null, audiences = null } = {}) {
  const audience = audiences || configuredAudiences();
  if (audience.length === 0) throw authError("GOOGLE_AUTH_NOT_CONFIGURED");
  if (typeof idToken !== "string" || idToken.length === 0 || idToken.length > 8192) {
    throw authError("GOOGLE_TOKEN_INVALID");
  }

  let payload;
  try {
    const ticket = await (client || defaultClient()).verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch {
    // Signature, audience, issuer or expiry failed. The reason is not echoed
    // to the client.
    throw authError("GOOGLE_TOKEN_INVALID");
  }

  if (!payload || typeof payload.sub !== "string" || payload.sub.length === 0 || !GOOGLE_ISSUERS.has(payload.iss)) {
    throw authError("GOOGLE_TOKEN_INVALID");
  }

  return {
    issuer: GOOGLE_ISSUER,
    subject: payload.sub,
    email: typeof payload.email === "string" ? payload.email.trim() : null,
    // Google sends a boolean; older tokens sent the string "true".
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
  };
}

module.exports = {
  verifyGoogleIdToken,
};
