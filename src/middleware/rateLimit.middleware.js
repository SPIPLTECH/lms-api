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

// Session and playback endpoints. Keyed on the user (after verifyToken) so a
// campus behind one NAT is not throttled as one client; the refresh endpoint
// has no user yet and stays per IP. Budgets sit well above normal use: the
// app refreshes about once per access-token lifetime, polls its session every
// few minutes and starts playback once per video opened.
const perUser = (prefix) => (req) => (req.user && req.user.id ? `${prefix}:${req.user.id}` : ipKeyGenerator(req));

const refreshRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many session refresh attempts, please try again shortly." }
});

const sessionStatusRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: perUser("session"),
  message: { success: false, message: "Too many session status requests, please try again shortly." }
});

const playbackStartRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: perUser("playback"),
  message: { success: false, message: "Too many playback requests, please try again shortly." }
});

// Proctored exam routes. Budgets allow for a long exam with frequent autosaves;
// a student who hits one sees a retry, and saved answers are not lost.
const proctoringAttemptRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: perUser("proctoring-attempt"),
  message: { success: false, message: "Too many exam requests, please try again shortly." }
});

const proctoringAnswerRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: perUser("proctoring-answer"),
  message: { success: false, message: "Too many answers saved at once, please try again shortly." }
});

module.exports = {
  proctoringAttemptRateLimiter,
  proctoringAnswerRateLimiter,
  refreshRateLimiter,
  sessionStatusRateLimiter,
  playbackStartRateLimiter,
  authRateLimiter,
  passwordResetRateLimiter,
  aiAssistantGuestRateLimiter,
  aiAssistantUserRateLimiter
};

