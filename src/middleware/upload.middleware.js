const multer = require("multer");
const path = require("path");
const fs = require("fs");

// =====================================
// Upload Directory
// =====================================

const uploadDir = path.join(__dirname, "../../uploads/attachments");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const badUploadError = (message) => {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
};

// =====================================
// Strict Extension & MIME Allow-Lists
// =====================================

// Active browser markup / executable formats (.svg, .xhtml, .xml, .html, .htm,
// .swf, .js, .exe, etc.) are intentionally excluded so stored XSS payloads
// cannot be uploaded and served back from /uploads.
const ALLOWED_ATTACHMENT_TYPES = {
  ".pdf": ["application/pdf"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".ppt": ["application/vnd.ms-powerpoint"],
  ".pptx": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".zip": ["application/zip", "application/x-zip-compressed"],
  ".csv": ["text/csv", "text/plain", "application/csv", "application/vnd.ms-excel"],
  ".tsv": ["text/tab-separated-values", "text/plain"],
  ".txt": ["text/plain"],
  ".md": ["text/markdown", "text/plain"],
  ".json": ["application/json", "text/plain"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".webp": ["image/webp"],
  ".gif": ["image/gif"],
  ".mp4": ["video/mp4"],
  ".webm": ["video/webm", "audio/webm"],
  ".mov": ["video/quicktime"],
  ".mp3": ["audio/mpeg", "audio/mp3"],
  ".wav": ["audio/wav", "audio/x-wav", "audio/wave"],
  ".ogg": ["audio/ogg", "video/ogg", "application/ogg"],
  ".m4a": ["audio/mp4", "audio/x-m4a", "video/mp4"],
};

const ALLOWED_ATTACHMENT_EXTENSIONS = Object.keys(ALLOWED_ATTACHMENT_TYPES);

const FORBIDDEN_MIMES = new Set([
  "image/svg+xml",
  "text/html",
  "application/xhtml+xml",
  "text/xml",
  "application/xml",
  "application/javascript",
  "text/javascript",
  "application/x-shockwave-flash",
  "application/x-msdownload",
  "application/x-executable",
]);

const ALLOWED_AVATAR_TYPES = {
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".webp": ["image/webp"],
  ".gif": ["image/gif"],
};

const allowedImportExtensions = [
  ".csv",
  ".xlsx",
  ".json",
  ".txt",
  ".tsv",
  ".pdf",
  ".docx",
];

const isAllowedMimeForExtension = (extension, rawMime, map = ALLOWED_ATTACHMENT_TYPES) => {
  const allowedMimes = map[extension];
  if (!allowedMimes) return false;
  const mime = String(rawMime || "").split(";")[0].trim().toLowerCase();
  if (FORBIDDEN_MIMES.has(mime)) return false;
  // Browsers/CLI clients occasionally report application/octet-stream; magic
  // bytes are verified immediately after upload in validateUploadedFileSignature.
  if (mime === "application/octet-stream" && map === ALLOWED_ATTACHMENT_TYPES) {
    return true;
  }
  return allowedMimes.includes(mime);
};

// =====================================
// Magic-Byte Signature Verification
// =====================================

const startsWithBytes = (buf, bytes, offset = 0) => {
  if (!Buffer.isBuffer(buf) || buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
};

const ISO_BMFF_BRANDS = new Set(["ftyp", "moov", "mdat", "wide", "free", "skip", "pnot"]);

const inspectFileMagicBytes = (buffer, filename) => {
  const ext = path.extname(String(filename || "")).toLowerCase();
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { valid: false, reason: "Uploaded file is empty." };
  }

  switch (ext) {
    case ".pdf":
      return startsWithBytes(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])
        ? { valid: true }
        : { valid: false, reason: "File content does not match PDF signature (%PDF-)." };

    case ".png":
      return startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        ? { valid: true }
        : { valid: false, reason: "File content does not match PNG signature." };

    case ".jpg":
    case ".jpeg":
      return startsWithBytes(buffer, [0xff, 0xd8, 0xff])
        ? { valid: true }
        : { valid: false, reason: "File content does not match JPEG signature." };

    case ".gif":
      return startsWithBytes(buffer, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
        startsWithBytes(buffer, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
        ? { valid: true }
        : { valid: false, reason: "File content does not match GIF signature." };

    case ".webp":
      return startsWithBytes(buffer, [0x52, 0x49, 0x46, 0x46]) &&
        startsWithBytes(buffer, [0x57, 0x45, 0x42, 0x50], 8)
        ? { valid: true }
        : { valid: false, reason: "File content does not match WebP signature." };

    case ".zip":
    case ".docx":
    case ".pptx":
    case ".xlsx":
      return startsWithBytes(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
        startsWithBytes(buffer, [0x50, 0x4b, 0x05, 0x06])
        ? { valid: true }
        : { valid: false, reason: `File content does not match ${ext.toUpperCase()} archive signature.` };

    case ".doc":
    case ".ppt":
      return startsWithBytes(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
        ? { valid: true }
        : { valid: false, reason: `File content does not match ${ext.toUpperCase()} compound document signature.` };

    case ".mp3":
      return startsWithBytes(buffer, [0x49, 0x44, 0x33]) ||
        (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
        ? { valid: true }
        : { valid: false, reason: "File content does not match MP3 audio signature." };

    case ".wav":
      return startsWithBytes(buffer, [0x52, 0x49, 0x46, 0x46]) &&
        startsWithBytes(buffer, [0x57, 0x41, 0x56, 0x45], 8)
        ? { valid: true }
        : { valid: false, reason: "File content does not match WAV audio signature." };

    case ".ogg":
      return startsWithBytes(buffer, [0x4f, 0x67, 0x67, 0x53])
        ? { valid: true }
        : { valid: false, reason: "File content does not match Ogg media signature." };

    case ".webm":
      return startsWithBytes(buffer, [0x1a, 0x45, 0xdf, 0xa3])
        ? { valid: true }
        : { valid: false, reason: "File content does not match WebM signature." };

    case ".mp4":
    case ".mov":
    case ".m4a": {
      if (buffer.length < 8) {
        return { valid: false, reason: "File is too small to be a valid MP4/MOV container." };
      }
      const boxType = buffer.subarray(4, 8).toString("ascii");
      return ISO_BMFF_BRANDS.has(boxType)
        ? { valid: true }
        : { valid: false, reason: `File content does not match ${ext.toUpperCase()} media container signature.` };
    }

    case ".txt":
    case ".csv":
    case ".tsv":
    case ".md":
    case ".json": {
      const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
      if (
        startsWithBytes(sample, [0x4d, 0x5a]) ||
        startsWithBytes(sample, [0x7f, 0x45, 0x4c, 0x46]) ||
        sample.includes(0x00)
      ) {
        return { valid: false, reason: "Binary content is not permitted inside a text upload." };
      }
      const head = sample.toString("utf8").replace(/^﻿/, "").trimStart().slice(0, 256).toLowerCase();
      if (
        head.startsWith("<!doctype html") ||
        head.startsWith("<html") ||
        head.startsWith("<svg") ||
        head.startsWith("<script") ||
        head.includes("<svg") ||
        head.includes("<!entity")
      ) {
        return { valid: false, reason: "Active HTML/SVG/XML markup is not permitted in text uploads." };
      }
      if (ext === ".json" && !head.startsWith("{") && !head.startsWith("[")) {
        return { valid: false, reason: "JSON file must begin with a JSON object or array." };
      }
      return { valid: true };
    }

    default:
      return { valid: false, reason: `File type ${ext || "unknown"} is not permitted for upload.` };
  }
};

const readHeaderBytes = (filePath, maxBytes = 4096) => {
  const fd = fs.openSync(filePath, "r");
  try {
    const stat = fs.fstatSync(fd);
    const len = Math.min(stat.size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
};

const cleanupRejectedFile = (file) => {
  if (file?.path && fs.existsSync(file.path)) {
    try {
      fs.unlinkSync(file.path);
    } catch {
      // Ignore cleanup race
    }
  }
};

const validateUploadedFileSignature = (req, res, next) => {
  const file = req.file;
  if (!file) return next();

  try {
    const headerBuffer = Buffer.isBuffer(file.buffer)
      ? file.buffer.subarray(0, Math.min(file.buffer.length, 4096))
      : file.path
        ? readHeaderBytes(file.path, 4096)
        : null;

    if (!headerBuffer) {
      cleanupRejectedFile(file);
      return next(badUploadError("Unable to inspect uploaded file contents."));
    }

    const check = inspectFileMagicBytes(headerBuffer, file.originalname);
    if (!check.valid) {
      cleanupRejectedFile(file);
      return next(badUploadError(check.reason));
    }

    return next();
  } catch (err) {
    cleanupRejectedFile(file);
    return next(badUploadError(`Invalid uploaded file: ${err.message}`));
  }
};

// =====================================
// Multer Upload Instances
// =====================================

const attachmentFileFilter = (req, file, cb) => {
  const extension = path.extname(String(file.originalname || "")).toLowerCase();
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.includes(extension)) {
    return cb(
      badUploadError(`File type ${extension || "(no extension)"} is not permitted for upload.`),
      false
    );
  }
  if (!isAllowedMimeForExtension(extension, file.mimetype, ALLOWED_ATTACHMENT_TYPES)) {
    return cb(
      badUploadError(`MIME type ${file.mimetype || "unknown"} is not permitted for ${extension} files.`),
      false
    );
  }
  cb(null, true);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const sanitizedOriginal = path.basename(file.originalname).replace(/[^a-zA-Z0-9.-]/g, "_");
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + sanitizedOriginal);
  },
});

const importFileFilter = (req, file, cb) => {
  const extension = path.extname(String(file.originalname || "")).toLowerCase();
  if (!allowedImportExtensions.includes(extension)) {
    return cb(badUploadError(`Unsupported import file format: ${extension || "(none)"}`), false);
  }
  if (FORBIDDEN_MIMES.has(String(file.mimetype || "").split(";")[0].trim().toLowerCase())) {
    return cb(badUploadError(`MIME type ${file.mimetype} is not permitted for import.`), false);
  }
  return cb(null, true);
};

// Attachments are kept in memory and stored in R2 by the route
// (utils/r2Storage.js) — the uploads/ folder does not survive a redeploy.
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: attachmentFileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
});

const importUpload = multer({
  storage,
  fileFilter: importFileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

const questionBufferUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: importFileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

const avatarFileFilter = (req, file, cb) => {
  const ext = path.extname(String(file.originalname || "")).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_AVATAR_TYPES, ext)) {
    return cb(badUploadError("Only raster image files (.jpg, .jpeg, .png, .webp, .gif) are allowed!"), false);
  }
  if (!isAllowedMimeForExtension(ext, file.mimetype, ALLOWED_AVATAR_TYPES)) {
    return cb(badUploadError("Avatar MIME type does not match allowed raster image formats!"), false);
  }
  return cb(null, true);
};

// Kept in memory; the controller stores the image in R2.
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: avatarFileFilter,
});

// =====================================
// Attachment Type Classification
// =====================================

const getAttachmentType = (mimeType, fileName) => {
  if (!mimeType) {
    return "OTHER";
  }
  if (mimeType.startsWith("image/")) {
    return "IMAGE";
  }
  if (mimeType.startsWith("video/")) {
    return "VIDEO";
  }
  if (mimeType.startsWith("audio/")) {
    return "AUDIO";
  }

  const docExtensions = [
    ".pdf",
    ".docx",
    ".doc",
    ".pptx",
    ".ppt",
    ".xlsx",
    ".txt",
    ".md",
    ".csv",
    ".json",
    ".tsv",
    ".zip",
  ];

  const extension = path.extname(String(fileName || "")).toLowerCase();
  if (
    docExtensions.includes(extension) ||
    mimeType.includes("pdf") ||
    mimeType.includes("document") ||
    mimeType.includes("presentation") ||
    mimeType.includes("sheet") ||
    mimeType.includes("msword") ||
    mimeType.includes("excel")
  ) {
    return "DOCUMENT";
  }

  return "OTHER";
};

module.exports = {
  upload,
  importUpload,
  questionBufferUpload,
  avatarUpload,
  getAttachmentType,
  ALLOWED_ATTACHMENT_EXTENSIONS,
  ALLOWED_ATTACHMENT_TYPES,
  ALLOWED_AVATAR_TYPES,
  allowedImportExtensions,
  attachmentFileFilter,
  importFileFilter,
  avatarFileFilter,
  inspectFileMagicBytes,
  validateUploadedFileSignature,
  // Retained as an alias so existing route imports validate magic bytes and
  // reject any active markup such as SVG outright.
  sanitizeSvgUpload: validateUploadedFileSignature,
};
