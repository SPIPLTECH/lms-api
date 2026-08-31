const Joi = require("joi");

/* Create Admin Validation */
const createAdminSchema = Joi.object({
  name: Joi.string().required().messages({
    "any.required": "Name is required"
  }),

  email: Joi.string().email().required().messages({
    "string.email": "Valid email is required",
    "any.required": "Valid email is required"
  }),

  password: Joi.string().min(6).required().messages({
    "string.min": "Password must be at least 6 characters",
    "any.required": "Password is required"
  }),

  phoneNumber: Joi.string().optional().allow(null, ""),
  address: Joi.string().optional().allow(null, ""),
  department: Joi.string().optional().allow(null, ""),
  designation: Joi.string().optional().allow(null, "")
});

/* Update User Validation */
const updateUserSchema = Joi.object({
  name: Joi.string().optional(),
  email: Joi.string().email().optional().messages({
    "string.email": "Invalid email"
  }),
  phoneNumber: Joi.string().optional().allow(null, ""),
  address: Joi.string().optional().allow(null, "")
});

/* Update User Status Validation */
const updateUserStatusSchema = Joi.object({
  status: Joi.string()
    .valid("ACTIVE", "INACTIVE", "SUSPENDED", "BLOCKED")
    .required()
    .messages({
      "any.only": "Invalid user status",
      "any.required": "Invalid user status"
    })
});

module.exports = {
  createAdminSchema,
  updateUserSchema,
  updateUserStatusSchema
};