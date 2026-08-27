const ApiError = require("../../../utils/ApiError");

/**
 * The simplest access gate of any agent in this series: this whole module is
 * ADMIN-only. Confirmed there is no separate institution-wide role in this
 * schema (Role enum is just ADMIN|INSTRUCTOR|STUDENT) — same conclusion
 * Analytics' own assertPlatformAccess already reached for its PLATFORM
 * scope, applied here to the entire module instead of one scope within it.
 */
const assertAdminAccess = (actor) => {
  if (!actor || actor.role !== "ADMIN") {
    throw new ApiError(403, "Admin intelligence is restricted to administrators");
  }
};

module.exports = { assertAdminAccess };
