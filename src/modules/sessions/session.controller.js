const sessionService = require("./session.service");

/**
 * GET /sessions/me — the caller's own session and device. Reaching this
 * handler already proves the session is valid (verifyToken ran), and doing so
 * counts as activity, so the client also uses it as its keep-alive.
 */
const getMySession = async (req, res, next) => {
  try {
    const data = await sessionService.getCurrentSession(req.user.sessionId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/** GET /admin/users/:id/sessions — recent sessions of one user (ADMIN). */
const listUserSessions = async (req, res, next) => {
  try {
    const data = await sessionService.listUserSessions(req.params.id);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/** POST /admin/sessions/:id/revoke — audited revocation (ADMIN). */
const revokeSession = async (req, res, next) => {
  try {
    await sessionService.adminRevokeSession(req.params.id, req.user.id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMySession,
  listUserSessions,
  revokeSession,
};
