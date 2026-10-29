const path = require("path");
const crypto = require("crypto");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

/**
 * Cloudflare R2, where uploaded files are stored (it replaced Vercel Blob).
 *
 * Every file goes in the private bucket (R2_PRIVATE_BUCKET). A stored file's
 * URL is its R2 address, https://<account>.r2.cloudflarestorage.com/<bucket>/<key>,
 * which refuses unsigned requests: the web app shows files through its
 * /api/blob-proxy route, and this API reads them through a short-lived signed
 * URL (signedR2Url). The web app has the same helpers in src/lib/server/r2.js.
 */

const R2_HOST_SUFFIX = ".r2.cloudflarestorage.com";
const SIGNED_URL_SECONDS = 300;

function settings() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PRIVATE_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_PRIVATE_BUCKET) return null;
  return {
    host: `${R2_ACCOUNT_ID.toLowerCase()}${R2_HOST_SUFFIX}`,
    bucket: R2_PRIVATE_BUCKET,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  };
}

let client = null;
function r2Client(config) {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${config.host}`,
      // <host>/<bucket>/<key>, the same shape as stored URLs.
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }
  return client;
}

function requireSettings() {
  const config = settings();
  if (!config) {
    const error = new Error("File storage is not configured on the server (R2_* settings are missing).");
    error.statusCode = 500;
    throw error;
  }
  return config;
}

/** The stored URL for an object key in the private bucket. */
function r2ObjectUrl(key) {
  const { host, bucket } = requireSettings();
  return `https://${host}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * The object key when `rawUrl` is a file in this account's private bucket,
 * else null. Strict on purpose: whatever passes gets signed and fetched, so
 * only our own host and bucket qualify, with no credentials, port, query or `..`.
 */
function parseR2Url(rawUrl) {
  const config = settings();
  if (!config || typeof rawUrl !== "string") return null;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== config.host) return null;
  if (url.username || url.password || url.port || url.search || url.hash) return null;
  const [, bucket, ...rest] = url.pathname.split("/");
  if (bucket !== config.bucket || rest.length === 0) return null;
  let segments;
  try {
    segments = rest.map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return segments.join("/");
}

/** A short-lived URL that reads `key` without credentials (Range requests work on it). */
async function signedR2Url(key) {
  const config = requireSettings();
  return getSignedUrl(r2Client(config), new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
    expiresIn: SIGNED_URL_SECONDS,
  });
}

/**
 * Stores an uploaded file (a multer memory-storage file: buffer, originalname,
 * mimetype) in R2's private bucket and returns { url, pathname }. The name is
 * `<prefix>/<timestamp>-<safe name>-<random><ext>`, unique and unguessable.
 *
 * `prefix` is the folder in the bucket. Never pass "assignment-submissions":
 * the evaluator treats that folder as student work (see
 * assignment-evaluation/submissionText.service.js).
 */
async function uploadFile(file, prefix, { sendFn } = {}) {
  const config = requireSettings();
  const safeName = path.basename(file.originalname || "file").replace(/[^a-zA-Z0-9.-]/g, "_");
  const ext = path.extname(safeName);
  const base = safeName.slice(0, safeName.length - ext.length) || "file";
  const pathname = `${prefix}/${Date.now()}-${base}-${crypto.randomBytes(12).toString("hex")}${ext}`;

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: pathname,
    Body: file.buffer,
    ContentType: file.mimetype || "application/octet-stream",
  });
  await (sendFn ? sendFn(command) : r2Client(config).send(command));
  return { url: r2ObjectUrl(pathname), pathname };
}

module.exports = { uploadFile, parseR2Url, signedR2Url, r2ObjectUrl };
