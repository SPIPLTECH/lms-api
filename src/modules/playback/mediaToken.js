const crypto = require("crypto");

/**
 * Signed, lease-bound media URLs.
 *
 * A token is `<base64url payload>.<base64url HMAC-SHA256>` where the payload
 * is { l: leaseId, c: contentId, e: expiry (unix seconds) }. The signature
 * stops a client from forging or editing one; on use, GET /playback/media
 * also requires the named lease to still be ACTIVE, so a copied URL stops
 * working within one lease TTL of its owner closing the player.
 *
 * Key: MEDIA_URL_SIGNING_SECRET, or — so a deployment that has not set it
 * yet still works — a key derived from JWT_ACCESS_SECRET for this purpose
 * only. Set the dedicated secret in production.
 */

const signingKey = () => {
  const dedicated = process.env.MEDIA_URL_SIGNING_SECRET;
  if (dedicated) return dedicated;
  const base = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
  if (!base) throw new Error("No secret configured for media URL signing.");
  return crypto.createHmac("sha256", base).update("orange-lms:media-url:v1").digest();
};

const sign = (payloadPart) => crypto.createHmac("sha256", signingKey()).update(payloadPart).digest("base64url");

function signMediaToken({ leaseId, contentId, expiresAt }) {
  const payload = { l: leaseId, c: contentId, e: Math.floor(new Date(expiresAt).getTime() / 1000) };
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadPart}.${sign(payloadPart)}`;
}

/** Returns { leaseId, contentId, expiresAt } or null if forged, malformed or expired. */
function verifyMediaToken(token, now = new Date()) {
  if (typeof token !== "string" || token.length > 1024) return null;
  const [payloadPart, signature, extra] = token.split(".");
  if (!payloadPart || !signature || extra !== undefined) return null;

  const expected = Buffer.from(sign(payloadPart));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload.l !== "string" || typeof payload.c !== "string" || !Number.isFinite(payload.e)) return null;
  if (payload.e * 1000 <= now.getTime()) return null;

  return { leaseId: payload.l, contentId: payload.c, expiresAt: new Date(payload.e * 1000) };
}

module.exports = { signMediaToken, verifyMediaToken };
