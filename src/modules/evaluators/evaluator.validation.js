const Joi = require("joi");
const { registerSchema } = require("../auth/auth.validation");

const emailField = Joi.string().email().required().messages({
  "string.email": "A valid email address is required.",
  "any.required": "Email is required.",
});

// The same fields and rules as student registration, plus the token proving
// the email was verified. Anything else — a role, an evaluator flag, dates —
// is stripped by the validator and never reaches the service: the server
// decides all of that.
const registerEvaluatorSchema = registerSchema.fork(["address"], (field) => field.strip()).keys({
  emailVerificationToken: Joi.string().max(2048).required().messages({
    "any.required": "Please verify your email address first.",
  }),
});

const sendEmailCodeSchema = Joi.object({ email: emailField });

const verifyEmailCodeSchema = Joi.object({
  email: emailField,
  otp: Joi.string()
    .pattern(/^[0-9]{6}$/)
    .required()
    .messages({
      "string.pattern.base": "The code must be 6 digits.",
      "any.required": "The code is required.",
    }),
  challenge: Joi.string().max(2048).required().messages({
    "any.required": "Please request a code first.",
  }),
});

module.exports = { registerEvaluatorSchema, sendEmailCodeSchema, verifyEmailCodeSchema, };
