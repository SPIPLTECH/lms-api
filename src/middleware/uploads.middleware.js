const path = require("path");
const express = require("express");
const { requiresPlaybackLease } = require("../config/accessPolicy");
const playbackService = require("../modules/playback/playback.service");
const { sendAuthError } = require("../utils/authErrors");
const { authenticate } = require("./auth.middleware");
const { evaluatorBlock } = require("../utils/evaluatorAccess");

/**
 * /uploads — files on the API's own disk.
 *
 *  - Public images: avatars/ and thumbnails/ (profiles, course cards and the
 *    catalog). Served to anyone, as before.
 *  - Everything else (course files: contents/, attachments/, course-imports/,
 *    …) is course-learning material:
 *      · the caller needs a valid session, presented as headers
 *        (Authorization: Bearer + X-Device-Key) — never in the URL, which
 *        would leak through logs, history and Referer;
 *      · an evaluator whose period has ended is refused, as by verifyToken;
 *      · ADMIN and INSTRUCTOR are not limited;
 *      · a STUDENT gets nothing while another device of the account holds the
 *        playback lease (409 CONTENT_ACTIVE_ON_ANOTHER_DEVICE), like the API's
 *        content routes (middleware/contentAccess.middleware.js).
 *    Browsers load these through the frontend's same-origin /api/uploads-proxy,
 *    which sends the session headers for them.
 */

const uploadsDir = path.join(__dirname, "../../uploads");

const PUBLIC_DIRS = ["avatars", "thumbnails"];

const servePublic = express.static(uploadsDir);
const serveProtected = express.static(uploadsDir, {
  setHeaders(res) {
    res.setHeader("Cache-Control", "private, no-store");
  },
});

const isPublicUpload = (requestPath) => {
  const first = requestPath.replace(/\\/g, "/").split("/").filter(Boolean)[0];
  return PUBLIC_DIRS.includes(first);
};

const bearerToken = (req) => {
  const header = req.headers.authorization;
  return header && header.startsWith("Bearer ") ? header.split(" ")[1] || null : null;
};

const uploadsHandler = async (req, res, next) => {
  if (isPublicUpload(req.path)) return servePublic(req, res, next);

  const token = bearerToken(req);
  if (!token) return sendAuthError(req, res, "AUTH_REQUIRED");

  let user;
  try {
    user = await authenticate(req, token);
  } catch (error) {
    if (error?.statusCode && error?.code) return sendAuthError(req, res, error);
    return next(error);
  }

  let block;
  try {
    block = await evaluatorBlock(user.id, req.originalUrl);
  } catch (error) {
    return next(error);
  }
  if (block) return res.status(block.status).json(block.body);

  if (requiresPlaybackLease(user.role)) {
    try {
      if (await playbackService.isPlaybackHeldElsewhere(user)) {
        return sendAuthError(req, res, "CONTENT_ACTIVE_ON_ANOTHER_DEVICE");
      }
    } catch (error) {
      return next(error);
    }
  }

  return serveProtected(req, res, next);
};

module.exports = uploadsHandler;
module.exports.isPublicUpload = isPublicUpload;
