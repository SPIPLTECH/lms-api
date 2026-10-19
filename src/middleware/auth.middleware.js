const jwt = require("jsonwebtoken");
const { isSessionCurrent, SessionCheckUnavailable } = require("../utils/sessionVersion");
const { evaluatorBlock } = require("../utils/evaluatorAccess");

const serviceUnavailable = (res) =>
  res.status(503).json({
    success: false,
    message: "Service temporarily unavailable. Please try again.",
  });

const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Token required",
      });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      if (req.path === "/logout" || req.originalUrl?.includes("/logout")) {
        req.user = { role: "GUEST" };
        return next();
      }
      return res.status(401).json({
        success: false,
        message: "Invalid token format",
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET
    );

    // Issued before the user's last password change (another browser's
    // session, now signed out) or before session versioning existed. A 401
    // sends the client through refresh, which only the current session passes.
    if (!(await isSessionCurrent(decoded))) {
      if (req.path === "/logout" || req.originalUrl?.includes("/logout")) {
        req.user = { role: "GUEST" };
        return next();
      }
      return res.status(401).json({
        success: false,
        message: "Session expired",
      });
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };

    // Evaluator accounts: learning access needs verified feedback while the
    // 48-hour period runs and ends with it — checked here, against the
    // database, so an older token that is still valid changes nothing. The
    // session itself stays valid (the client needs it to show why).
    let block;
    try {
      block = await evaluatorBlock(decoded.id, req.originalUrl);
    } catch {
      return serviceUnavailable(res);
    }
    if (block) return res.status(block.status).json(block.body);

    next();
  } catch (error) {
    if (req.path === "/logout" || req.originalUrl?.includes("/logout")) {
      req.user = { role: "GUEST" };
      return next();
    }

    // Not a 401: that would send the client through refresh and sign it out
    // over a database blip.
    if (error instanceof SessionCheckUnavailable) {
      return serviceUnavailable(res);
    }

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired",
      });
    }

    return res.status(401).json({
      success: false,
      message: "Invalid token",
    });
  }
};

const optionalToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      req.user = { role: "GUEST" };
      return next();
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      req.user = { role: "GUEST" };
      return next();
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET
    );

    // A signed-out session browses as a guest, same as an invalid token.
    if (!(await isSessionCurrent(decoded))) {
      req.user = { role: "GUEST" };
      return next();
    }

    // A blocked evaluator gets only what a guest gets (any error lands in the
    // catch below, which does the same).
    if (await evaluatorBlock(decoded.id, req.originalUrl)) {
      req.user = { role: "GUEST" };
      return next();
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (error) {
    req.user = { role: "GUEST" };
    next();
  }
};

module.exports = verifyToken;
module.exports.verifyToken = verifyToken;
module.exports.optionalToken = optionalToken;
