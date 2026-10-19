const Joi = require("joi");
const { passwordField } = require("./password.policy");

/**
 * Auth Validation Schemas
 *
 * These schemas validate request bodies before they reach the controller.
 * Validated + stripped bodies are written back to req.body by the middleware
 * runner (joiValidation.middleware.js), so the controller receives only
 * safe, well-typed data.
 */

const registerSchema = Joi.object({
  name: Joi.string().min(2).max(100).required().messages({
    "string.min": "Name must be at least 2 characters.",
    "string.max": "Name must be at most 100 characters.",
    "any.required": "Name is required.",
  }),

  email: Joi.string().email().required().messages({
    "string.email": "A valid email address is required.",
    "any.required": "Email is required.",
  }),

  password: passwordField("Password"),

  phoneNumber: Joi.string()
    .pattern(/^\+?[0-9]{7,15}$/)
    .optional()
    .allow(null, "")
    .messages({
      "string.pattern.base": "Phone number must be 7–15 digits.",
    }),

  address: Joi.string().max(255).optional().allow(null, ""),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "A valid email address is required.",
    "any.required": "Email is required.",
  }),

  password: Joi.string().min(1).max(128).required().messages({
    "any.required": "Password is required.",
  }),
});

const verifyOtpSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "A valid email address is required.",
    "any.required": "Email is required.",
  }),

  otp: Joi.string()
    .pattern(/^[0-9]{6}$/)
    .required()
    .messages({
      "string.pattern.base": "OTP must be a 6-digit number.",
      "any.required": "OTP is required.",
    }),
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "A valid email address is required.",
    "any.required": "Email is required.",
  }),
});

// Step 1 of the reset flow: check the emailed OTP without consuming it.
const verifyResetOtpSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "A valid email address is required.",
    "any.required": "Email is required.",
  }),

  otp: Joi.string()
    .pattern(/^[0-9]{6}$/)
    .required()
    .messages({
      "string.pattern.base": "OTP must be a 6-digit number.",
      "any.required": "OTP is required.",
    }),
});

const resetPasswordSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "A valid email address is required.",
    "any.required": "Email is required.",
  }),

  otp: Joi.string()
    .pattern(/^[0-9]{6}$/)
    .required()
    .messages({
      "string.pattern.base": "OTP must be a 6-digit number.",
      "any.required": "OTP is required.",
    }),

  newPassword: passwordField("New password"),
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().min(1).max(128).required().messages({
    "any.required": "Current password is required.",
  }),

  newPassword: passwordField("New password")
    .invalid(Joi.ref("currentPassword"))
    .messages({
      "any.invalid": "New password must be different from your current password.",
    }),
});

const resendVerificationSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "A valid email address is required.",
    "any.required": "Email is required.",
  }),
});

module.exports = {
  registerSchema,
  loginSchema,
  verifyOtpSchema,
  forgotPasswordSchema,
  verifyResetOtpSchema,
  resetPasswordSchema,
  changePasswordSchema,
  resendVerificationSchema,
};
