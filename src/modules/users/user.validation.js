const Joi = require("joi");

const updateUserSchema = Joi.object({
  name: Joi.string().min(2).max(100).optional(),
  phoneNumber: Joi.string()
    .pattern(/^\+?[0-9]{7,15}$/)
    .optional()
    .allow(null, ""),
  address: Joi.string().max(255).optional().allow(null, ""),
});

const updateUserStatusSchema = Joi.object({
  status: Joi.string()
    .valid("ACTIVE", "INACTIVE", "SUSPENDED", "BLOCKED")
    .required()
    .messages({
      "any.only": "Status must be one of: ACTIVE, INACTIVE, SUSPENDED, BLOCKED",
      "any.required": "Status is required",
    }),
});

const updateUserRoleSchema = Joi.object({
  role: Joi.string()
    .valid("ADMIN", "INSTRUCTOR", "STUDENT", "GUEST")
    .required()
    .messages({
      "any.only": "Role must be one of: ADMIN, INSTRUCTOR, STUDENT, GUEST",
      "any.required": "Role is required",
    }),
});

module.exports = {
  updateUserSchema,
  updateUserStatusSchema,
  updateUserRoleSchema,
};
