const playbackService = require("../modules/playback/playback.service");
const { requiresPlaybackLease } = require("../config/accessPolicy");
const { authError } = require("../utils/authErrors");

/**
 * STUDENT content access follows the account's playback lease
 * (config/accessPolicy.js): while one device of a student account is playing
 * protected video, the account's other devices cannot read course content or
 * act on it. They get 409 CONTENT_ACTIVE_ON_ANOTHER_DEVICE until that lease
 * is stopped or expires. The device holding the lease is unaffected.
 *
 * Runs after verifyToken/optionalToken (it needs the server-verified
 * session and device on req.user) and before the handler, so a refused
 * request never loads content. ADMIN, INSTRUCTOR and guests pass through.
 *
 * `skip(req)` exempts a request shape that carries no course content (e.g.
 * GET /courses/:id?include=meta).
 */
const contentAccess = ({ skip = null } = {}) => async (req, res, next) => {
  try {
    if (!req.user || !requiresPlaybackLease(req.user.role)) return next();
    if (skip && skip(req)) return next();
    if (await playbackService.isPlaybackHeldElsewhere(req.user)) {
      return next(authError("CONTENT_ACTIVE_ON_ANOTHER_DEVICE"));
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

const requireContentAccess = contentAccess();

module.exports = requireContentAccess;
module.exports.requireContentAccess = requireContentAccess;
module.exports.contentAccess = contentAccess;
