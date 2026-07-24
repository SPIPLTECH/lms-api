const jwt = require("jsonwebtoken");

const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
      req.user = {
        role: "GUEST",
      };
      return next();
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

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (error) {
    if (req.path === "/logout" || req.originalUrl?.includes("/logout")) {
      req.user = { role: "GUEST" };
      return next();
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

module.exports = verifyToken;