const Joi = require("joi");

const updateUserSchema = Joi.object({
  name: Joi.string().min(2).max(100).optional(),
  phoneNumber: Joi.string()
    .pattern(/^\+?[0-9\s\-()]{7,20}$/)
    .optional()
    .allow(null, ""),
  address: Joi.string().max(255).optional().allow(null, ""),
  avatar: Joi.string().optional().allow(null, ""),

  // Student profile fields (StudentProfile)
  education: Joi.string().max(255).optional().allow(null, ""),
  institution: Joi.string().max(255).optional().allow(null, ""),
  graduationYear: Joi.string().max(50).optional().allow(null, ""),
  gender: Joi.string().max(50).optional().allow(null, ""),
  dateOfBirth: Joi.date().optional().allow(null, ""),
  guardianName: Joi.string().max(150).optional().allow(null, ""),
  phone: Joi.string().max(20).optional().allow(null, ""),
  profileVisibility: Joi.string().valid("Public", "Private").optional(),
  focusTopics: Joi.string().max(500).optional().allow(null, ""),
  interests: Joi.string().max(500).optional().allow(null, ""),
  learningGoals: Joi.string().max(1000).optional().allow(null, ""),
  videoQuality: Joi.string().max(50).optional(),
  downloadOverWifi: Joi.boolean().optional(),
  plan: Joi.string().max(50).optional(),

  // Instructor profile fields (TeacherProfile)
  specialization: Joi.string().max(150).optional().allow(null, ""),
  qualification: Joi.string().max(150).optional().allow(null, ""),
  experience: Joi.number().integer().min(0).max(100).optional().allow(null),
  bio: Joi.string().max(2000).optional().allow(null, ""),
  notificationPreferences: Joi.object().optional(),

  // Shared preference fields (both StudentProfile and TeacherProfile)
  language: Joi.string().max(50).optional(),
  timezone: Joi.string().max(50).optional(),
  themeMode: Joi.string().max(50).optional(),
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
