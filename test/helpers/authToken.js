const jwt = require("jsonwebtoken");

// Mirrors the payload shape auth.middleware.js decodes ({ id, email, role })
// and the same secret precedence it verifies against, so HTTP-level tests
// can mint a valid Bearer token without going through the real login flow.
const mintAccessToken = (user) => {
  const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    secret,
    { expiresIn: "1h" }
  );
};

module.exports = { mintAccessToken };
