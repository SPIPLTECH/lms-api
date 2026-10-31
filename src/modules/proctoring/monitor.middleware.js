const fs = require("fs");
const multer = require("multer");
const { randomUUID } = require("crypto");

const ApiError = require("../../utils/ApiError");
const { attemptTempDir, removeFile } = require("./evidence.service");
const { verifyMonitorToken } = require("./monitorToken");
const registry = require("./monitorRegistry");

/**
 * Monitoring routes authenticate with the attempt's own token, checked in memory, instead of
 * verifyToken, whose session query would cost the database a round trip per frame.
 */

const MAX_FRAME_BYTES = 2 * 1024 * 1024;

async function monitorAuth(req, res, next) {
  try {
    const claims = verifyMonitorToken(req.get("X-Proctoring-Token"));
    if (!claims) throw new ApiError(401, "Exam monitoring needs a valid token. Reload the exam page.", "MONITORING_TOKEN_INVALID");
    const monitor = await registry.load(claims.attemptId);
    if (!monitor) throw new ApiError(401, "Exam monitoring needs a valid token. Reload the exam page.", "MONITORING_TOKEN_INVALID");
    if (monitor.ended) throw new ApiError(409, "This exam has ended.", "ATTEMPT_ENDED");
    if (claims.version !== monitor.tokenVersion) throw new ApiError(409, "This exam is now open in another tab or device.", "TOKEN_SUPERSEDED");
    req.monitor = monitor;
    next();
  } catch (error) {
    next(error);
  }
}

const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    const dir = attemptTempDir(req.monitor.id);
    fs.promises.mkdir(dir, { recursive: true }).then(() => callback(null, dir), callback);
  },
  // Never from the client.
  filename: (req, file, callback) => callback(null, `${randomUUID()}.img`),
});

const receive = multer({ storage, limits: { fileSize: MAX_FRAME_BYTES, files: 1, fields: 6 } }).single("snapshot");

function sniffImage(head) {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Saves the frame to disk and checks it really is an image, by its bytes rather than what the client says. */
function receiveFrame(req, res, next) {
  receive(req, res, async (error) => {
    if (error) {
      if (error.code === "LIMIT_FILE_SIZE") return next(new ApiError(413, "This image is too large.", "FRAME_TOO_LARGE"));
      return next(error instanceof multer.MulterError ? new ApiError(400, "This upload could not be read.", "FRAME_INVALID") : error);
    }
    if (!req.file) return next(new ApiError(400, "No image was sent.", "FRAME_MISSING"));
    try {
      const handle = await fs.promises.open(req.file.path, "r");
      const head = Buffer.alloc(12);
      await handle.read(head, 0, 12, 0);
      await handle.close();
      const mimetype = sniffImage(head);
      if (!mimetype) {
        await removeFile(req.file.path);
        return next(new ApiError(415, "Only JPEG, PNG or WebP images are accepted.", "FRAME_NOT_AN_IMAGE"));
      }
      req.file.mimetype = mimetype;
      next();
    } catch (readError) {
      await removeFile(req.file.path);
      next(readError);
    }
  });
}

module.exports = { monitorAuth, receiveFrame };
