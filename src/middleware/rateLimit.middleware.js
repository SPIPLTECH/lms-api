const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 auth attempts per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many authentication requests from this IP, please try again after 15 minutes."
  }
});

const passwordResetRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Limit each IP to 5 OTP/password reset requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many password reset attempts, please try again after an hour."
  }
});

const llmRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // Limit each IP to 20 LLM generate requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many LLM requests from this IP, please try again shortly."
  }
});

// AI Assistant. Two tiers, because the cost profile differs sharply:
//
// - Guest traffic is unauthenticated, so the only handle is the IP. It is
//   also the easiest surface to abuse for free Gemini tokens, hence the
//   tighter budget.
// - Authenticated traffic is keyed on the user id rather than the IP, so a
//   whole campus or office behind one NAT gateway is not throttled as a
//   single client. Falls back to IP when no user is attached.
const aiAssistantGuestRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "You have reached the assistant's limit for now. Please try again later, or sign in."
  }
});

const aiAssistantUserRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user.id ? `ai:${req.user.id}` : ipKeyGenerator(req)),
  message: {
    success: false,
    message: "You have reached the assistant's usage limit. Please try again shortly."
  }
});

module.exports = {
  authRateLimiter,
  passwordResetRateLimiter,
  llmRateLimiter,
  aiAssistantGuestRateLimiter,
  aiAssistantUserRateLimiter
};

