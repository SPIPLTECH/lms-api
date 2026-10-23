const playbackService = require("./playback.service");

const startPlayback = async (req, res, next) => {
  try {
    const data = await playbackService.startPlayback(req.user, req.body.contentId);
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const heartbeat = async (req, res, next) => {
  try {
    await playbackService.heartbeat(req.user, req.body.leaseId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

const stopPlayback = async (req, res, next) => {
  try {
    await playbackService.stopPlayback(req.user, req.body);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

const getStatus = async (req, res, next) => {
  try {
    const data = await playbackService.getStatus(req.user);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /playback/media/:token — the signed URL is the credential (a <video>
 * element cannot send an Authorization header). Errors are plain JSON with a
 * code; the media element only sees a failed load.
 */
const streamMedia = async (req, res, next) => {
  try {
    await playbackService.serveMedia(req, res, req.params.token);
  } catch (error) {
    if (res.headersSent) return res.destroy();
    next(error);
  }
};

module.exports = {
  startPlayback,
  heartbeat,
  stopPlayback,
  getStatus,
  streamMedia,
};
