const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

/**
 * Where kept proctoring images live, behind one interface: put, get, delete. Drivers: "r2"
 * (a private bucket: its own, or the LMS's private bucket by default; NOT tested against
 * real R2) and "local" (development). Every object is encrypted here with AES-256-GCM before it
 * leaves the process, so neither driver ever holds a readable image.
 *
 * Format: "PGE1" | key id length (1 byte) | key id | iv (12) | tag (16) | ciphertext.
 * The object key is authenticated too, so an object cannot be moved to another name.
 */

const MAGIC = Buffer.from("PGE1");
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** "k2:<base64 of 32 bytes>,k1:<...>". The first key encrypts; all of them decrypt, for rotation. */
function parseKeys(raw) {
  const entries = String(raw || "").split(",").map((part) => part.trim()).filter(Boolean);
  if (entries.length === 0) throw new Error("PROCTORING_EVIDENCE_KEYS is required.");
  const byId = new Map();
  let active = null;
  for (const entry of entries) {
    const colon = entry.indexOf(":");
    const id = colon > 0 ? entry.slice(0, colon) : "";
    const key = colon > 0 ? Buffer.from(entry.slice(colon + 1), "base64") : Buffer.alloc(0);
    if (!id || id.length > 32 || key.length !== 32) {
      throw new Error("PROCTORING_EVIDENCE_KEYS entries must be id:<base64 of 32 bytes>.");
    }
    byId.set(id, key);
    active = active ?? { id, key };
  }
  return { active, byId };
}

function encrypt(plaintext, objectKey, keys) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", keys.active.key, iv);
  cipher.setAAD(Buffer.from(objectKey));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const id = Buffer.from(keys.active.id);
  return Buffer.concat([MAGIC, Buffer.from([id.length]), id, iv, cipher.getAuthTag(), ciphertext]);
}

function decrypt(sealed, objectKey, keys) {
  const buffer = Buffer.from(sealed);
  if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not an encrypted evidence object.");
  const idLength = buffer[MAGIC.length];
  const idEnd = MAGIC.length + 1 + idLength;
  const key = keys.byId.get(buffer.subarray(MAGIC.length + 1, idEnd).toString());
  if (!key) throw new Error("Evidence object uses an unknown key.");
  const iv = buffer.subarray(idEnd, idEnd + IV_BYTES);
  const tag = buffer.subarray(idEnd + IV_BYTES, idEnd + IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(objectKey));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(buffer.subarray(idEnd + IV_BYTES + TAG_BYTES)), decipher.final()]);
}

function createLocalStore({ dir, keys }) {
  const root = path.resolve(dir);
  const locate = (objectKey) => {
    const file = path.resolve(root, objectKey);
    if (!file.startsWith(root + path.sep)) throw new Error("Invalid evidence object key.");
    return file;
  };
  return {
    async put(objectKey, plaintext) {
      const file = locate(objectKey);
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, encrypt(plaintext, objectKey, keys));
    },
    async get(objectKey) {
      return decrypt(await fs.promises.readFile(locate(objectKey)), objectKey, keys);
    },
    async delete(objectKey) {
      await fs.promises.rm(locate(objectKey), { force: true });
    },
  };
}

function createR2Store({ client, bucket, keys }) {
  if (!bucket) throw new Error("PROCTORING_R2_BUCKET is required for the r2 evidence store.");
  return {
    async put(objectKey, plaintext) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: encrypt(plaintext, objectKey, keys), ContentType: "application/octet-stream" }));
    },
    async get(objectKey) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
      return decrypt(Buffer.from(await response.Body.transformToByteArray()), objectKey, keys);
    },
    async delete(objectKey) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
    },
  };
}

/**
 * R2 settings: PROCTORING_R2_* when set, otherwise the LMS's own private bucket (R2_ACCOUNT_ID,
 * R2_PRIVATE_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY), so a shared account needs no copies.
 * The key pair is taken as a pair, never one half from each. The public bucket is never used.
 */
function r2Settings(env = process.env) {
  const ownKeys = Boolean(env.PROCTORING_R2_ACCESS_KEY_ID || env.PROCTORING_R2_SECRET_ACCESS_KEY);
  return {
    endpoint: env.PROCTORING_R2_ENDPOINT || (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID.trim().toLowerCase()}.r2.cloudflarestorage.com` : undefined),
    bucket: env.PROCTORING_R2_BUCKET || env.R2_PRIVATE_BUCKET,
    credentials: ownKeys
      ? { accessKeyId: env.PROCTORING_R2_ACCESS_KEY_ID, secretAccessKey: env.PROCTORING_R2_SECRET_ACCESS_KEY }
      : { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  };
}

/** The store the settings name. Throws when they are incomplete, so an exam cannot begin without one. */
function createConfiguredStore(env = process.env) {
  const keys = parseKeys(env.PROCTORING_EVIDENCE_KEYS);
  const driver = (env.PROCTORING_STORAGE_DRIVER || "r2").trim().toLowerCase();
  if (driver === "local") {
    if (!env.PROCTORING_LOCAL_STORE_DIR) throw new Error("PROCTORING_LOCAL_STORE_DIR is required for the local evidence store.");
    return createLocalStore({ dir: env.PROCTORING_LOCAL_STORE_DIR, keys });
  }
  if (driver === "r2") {
    const settings = r2Settings(env);
    const client = new S3Client({
      region: "auto",
      endpoint: settings.endpoint,
      // <host>/<bucket>/<key>, as the LMS's own R2 client (src/utils/r2Storage.js) does.
      forcePathStyle: true,
      credentials: settings.credentials,
    });
    return createR2Store({ client, bucket: settings.bucket, keys });
  }
  throw new Error("PROCTORING_STORAGE_DRIVER must be r2 or local.");
}

module.exports = { createConfiguredStore, createLocalStore, createR2Store, decrypt, encrypt, parseKeys, r2Settings };
