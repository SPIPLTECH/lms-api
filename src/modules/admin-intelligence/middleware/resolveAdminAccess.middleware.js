const ApiError = require("../../../utils/ApiError");
const { assertAdminAccess } = require("../utils/accessControl.util");

/**
 * Resolves req.adminActor = { userId, role } and gates the entire module —
 * ADMIN-only, the simplest access check of any agent in this series (no
 * separate institution-wide role exists in this schema). Kept as its own
 * copy per this codebase's per-agent convention (each agent's HTTP layer
 * stays independently deployable).
 */
const resolveAdminAccess = (req, res, next) => {
  try {
    const { id: userId, role } = req.user || {};

    if (!userId || role === "GUEST") {
      throw new ApiError(401, "Authentication required to access admin intelligence");
    }

    const actor = { userId, role };
    assertAdminAccess(actor);

    req.adminActor = actor;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = resolveAdminAccess;
