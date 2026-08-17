const jwt = require("jsonwebtoken");

const ApiError = require("../../utils/ApiError");

/**
 * Verification questions are deliberately ephemeral — generated on demand,
 * answered once, then discarded (see verificationQuestion.builder.js and
 * "MAX_VERIFICATION_QUESTIONS_PER_CYCLE = 1" in adaptiveLearning.service.js).
 * They never touch the Question/QuizQuestion tables (that would either leak
 * into instructor-facing question-repository listings, or require new,
 * unapproved schema — see the architecture report). Instead, the correct
 * answer and originating context are carried in a short-lived, signed token
 * handed to the browser alongside the question text/options (never the
 * correct answer itself) and echoed back unmodified when the student
 * submits — the same signing mechanism already used for auth tokens
 * (jsonwebtoken), just scoped to a distinct `purpose` so it can never be
 * confused with — or accepted as — a real access token.
 */
const VERIFICATION_TOKEN_PURPOSE = "adaptive_verification_question";
const VERIFICATION_TOKEN_TTL = "15m";

const getSecret = () => process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;

const signVerificationToken = (claims) =>
  jwt.sign({ ...claims, purpose: VERIFICATION_TOKEN_PURPOSE }, getSecret(), {
    expiresIn: VERIFICATION_TOKEN_TTL,
  });

const verifyVerificationToken = (token) => {
  if (typeof token !== "string" || !token) {
    throw new ApiError(400, "Verification token is required.");
  }

  let decoded;
  try {
    decoded = jwt.verify(token, getSecret());
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw new ApiError(410, "This verification question has expired. Please request a new one.");
    }
    throw new ApiError(400, "Invalid verification token.");
  }

  if (decoded.purpose !== VERIFICATION_TOKEN_PURPOSE) {
    throw new ApiError(400, "Invalid verification token.");
  }

  return decoded;
};

module.exports = { signVerificationToken, verifyVerificationToken };
