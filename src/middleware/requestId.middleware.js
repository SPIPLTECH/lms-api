const crypto = require("crypto");

/**
 * Correlation id for every request: echoed in `X-Request-Id` and in the
 * `error.requestId` of error responses, so a support report can be matched
 * to a server log line without the client sending anything sensitive.
 *
 * An inbound id from a proxy is kept only if it is short and plain.
 */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

const requestId = (req, res, next) => {
  const inbound = req.get("x-request-id");
  req.requestId = inbound && SAFE_ID.test(inbound) ? inbound : crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
};

module.exports = requestId;
