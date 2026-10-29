const path = require("path");
const { put } = require("@vercel/blob");

/**
 * Stores an uploaded file (a multer memory-storage file: buffer, originalname,
 * mimetype) in Vercel Blob and returns put()'s result ({ url, pathname, ... }).
 *
 * Files used to be written to this API's uploads/ folder, which a redeploy or
 * restart on Render wipes. The same Blob store backs the web app's /api/upload
 * route, so this reads the same token names.
 *
 * `prefix` is the folder in the store. Never pass "assignment-submissions":
 * the evaluator treats that folder as student work (see
 * assignment-evaluation/submissionText.service.js).
 */
async function uploadToBlob(file, prefix, { putFn = put } = {}) {
  const token = process.env.VERCEL_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    const error = new Error("File storage is not configured on the server (BLOB_READ_WRITE_TOKEN is missing).");
    error.statusCode = 500;
    throw error;
  }

  const safeName = path.basename(file.originalname || "file").replace(/[^a-zA-Z0-9.-]/g, "_");
  const pathname = `${prefix}/${Date.now()}-${safeName}`;

  // Public first, as the web app's /api/upload does for non-media files; a
  // store fixed to private access rejects that, so fall back to private (the
  // web app shows private blobs through its /api/blob-proxy route).
  let lastError;
  for (const access of ["public", "private"]) {
    try {
      return await putFn(pathname, file.buffer, {
        access,
        token,
        addRandomSuffix: true,
        contentType: file.mimetype,
      });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      // Only a store/access-mode mismatch is worth trying the other mode.
      if (!/private|public|access/i.test(message)) throw error;
    }
  }
  throw lastError;
}

module.exports = { uploadToBlob };
