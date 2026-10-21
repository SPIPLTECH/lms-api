const { withholdVideoSources, shouldWithholdFor } = require("../utils/mediaProtection");

/**
 * Wraps res.json so that, for students, guests and unauthenticated callers,
 * no response carries a VIDEO content row's source URL. See
 * utils/mediaProtection.js for why this is one global choke point.
 *
 * Mounted before the routers; the decision is made when the response is
 * sent, by which time the route's own auth middleware has set req.user.
 */
const protectVideoSources = (req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body) => json(shouldWithholdFor(req.user) ? withholdVideoSources(body) : body);
  next();
};

module.exports = protectVideoSources;
